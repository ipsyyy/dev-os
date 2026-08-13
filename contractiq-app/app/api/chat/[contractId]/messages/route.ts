import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAzureAgentClient, agentReferenceBody } from '@/lib/azure/client'
import { classifyQuery, buildChatSystemPrompt, validateCitation, CITATION_RETRY_REMINDER } from '@/lib/claude/chat-prompt'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_MESSAGE_LENGTH = 2000
const MESSAGE_FETCH_LIMIT = 200
const RETRY_DELAYS_MS = [1000, 2000, 4000]

function errorResponse(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, ...(message ? { message } : {}) } }, { status })
}

type SupabaseServerClient = ReturnType<typeof createClient>

async function getOrCreateSession(supabase: SupabaseServerClient, contractId: string, userId: string) {
  const { data: existing } = await supabase.from('chat_sessions').select('*').eq('contract_id', contractId).maybeSingle()
  if (existing) return existing

  const { data: created, error } = await supabase
    .from('chat_sessions')
    .insert({ contract_id: contractId, user_id: userId })
    .select()
    .single()

  if (error || !created) throw error ?? new Error('Failed to create chat session')
  return created
}

async function checkAccess(supabase: SupabaseServerClient, contractId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: errorResponse(401, 'unauthorized', 'Authentication required') } as const
  }

  // Same RLS-driven anti-enumeration pattern as POST /api/contracts/[id]/process:
  // a contract that exists but isn't the caller's own comes back null, same as
  // one that doesn't exist at all, so there's only ever a 404 here — no 403.
  const { data: contract } = await supabase.from('contracts').select('id, contract_text').eq('id', contractId).maybeSingle()

  if (!contract) {
    return { error: errorResponse(404, 'not_found', 'Contract not found.') } as const
  }

  return { user, contract } as const
}

function buildInputText(contextPrompt: string, history: { role: string; content: string }[], question: string, extraReminder?: string) {
  const historyText = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')

  return [
    contextPrompt,
    historyText ? `Conversation history:\n${historyText}` : null,
    extraReminder ?? null,
    `User: ${question}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
}

export async function GET(request: Request, { params }: { params: { contractId: string } }) {
  const supabase = createClient()
  const access = await checkAccess(supabase, params.contractId)
  if ('error' in access) return access.error

  let session
  try {
    session = await getOrCreateSession(supabase, params.contractId, access.user.id)
  } catch {
    return errorResponse(500, 'chat_session_failed', 'Something went wrong loading chat history.')
  }

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, role, content, page_citation, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_FETCH_LIMIT)

  return NextResponse.json({ session_id: session.id, messages: messages ?? [] })
}

export async function POST(request: Request, { params }: { params: { contractId: string } }) {
  const supabase = createClient()
  const access = await checkAccess(supabase, params.contractId)
  if ('error' in access) return access.error
  const { user, contract } = access

  const body = await request.json().catch(() => null)
  const rawMessage = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!rawMessage || rawMessage.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(400, 'invalid_message', 'Message must be between 1 and 2000 characters.')
  }

  let session
  try {
    session = await getOrCreateSession(supabase, params.contractId, user.id)
  } catch {
    return errorResponse(500, 'chat_session_failed', 'Something went wrong. Please try again.')
  }

  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_FETCH_LIMIT)

  const classification = classifyQuery(rawMessage)
  // The agent's system prompt lives in the Azure portal, not per-request — the
  // Responses API rejects `instructions` when an agent_reference is set. So the
  // citation-format contract that used to be Anthropic's `system` field is
  // bundled straight into the single input message instead.
  const contextPrompt = buildChatSystemPrompt(contract.contract_text ?? '', classification)
  const historyMessages = (history ?? []) as { role: string; content: string }[]

  const client = createAzureAgentClient()

  let assistantText: string | null = null
  let pageCitation: number | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]))
    }

    try {
      const response = await client.responses.create(
        { input: [{ role: 'user', content: buildInputText(contextPrompt, historyMessages, rawMessage) }] },
        { body: agentReferenceBody() }
      )

      const text = response.output_text ?? ''
      const citation = validateCitation(text)

      if (citation.valid) {
        assistantText = text
        pageCitation = citation.pageCitation
      } else {
        // One automatic retry for a missing citation — separate from the
        // outer network/5xx retry loop and always exactly one attempt, per spec §2/§3.
        try {
          const retryResponse = await client.responses.create(
            {
              input: [
                { role: 'user', content: buildInputText(contextPrompt, historyMessages, rawMessage, CITATION_RETRY_REMINDER) },
              ],
            },
            { body: agentReferenceBody() }
          )
          const retryText = retryResponse.output_text ?? ''
          const retryCitation = validateCitation(retryText)

          if (retryCitation.valid) {
            assistantText = retryText
            pageCitation = retryCitation.pageCitation
          } else {
            assistantText = `⚠️ ${retryText}`
            pageCitation = null
          }
        } catch {
          // The reminder call itself failed on a network hiccup — fall back to
          // the original (uncited) response rather than losing the turn entirely.
          assistantText = `⚠️ ${text}`
          pageCitation = null
        }
      }

      break
    } catch (err) {
      // network/5xx failure on the primary call — retried by the outer loop,
      // unless this was the last attempt, in which case surface the real error.
      if (attempt === RETRY_DELAYS_MS.length) {
        const message = err instanceof Error ? err.message : 'Unknown Azure agent error'
        return errorResponse(502, 'ai_provider_error', message)
      }
    }
  }

  if (assistantText === null) {
    return errorResponse(502, 'ai_provider_error', "We couldn't get a response right now. Try again in a few minutes.")
  }

  const { data: userRow, error: userInsertError } = await supabase
    .from('chat_messages')
    .insert({ session_id: session.id, role: 'user', content: rawMessage })
    .select()
    .single()

  if (userInsertError || !userRow) {
    return errorResponse(500, 'chat_persist_failed', 'Something went wrong saving this message.')
  }

  const { data: assistantRow, error: assistantInsertError } = await supabase
    .from('chat_messages')
    .insert({ session_id: session.id, role: 'assistant', content: assistantText, page_citation: pageCitation })
    .select()
    .single()

  if (assistantInsertError || !assistantRow) {
    // Azure already generated a reply — don't leave the user's turn orphaned
    // with no response and no way to tell a retry from a duplicate question.
    await supabase.from('chat_messages').delete().eq('id', userRow.id)
    return errorResponse(500, 'chat_persist_failed', 'Something went wrong saving this message.')
  }

  await supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', session.id)

  return NextResponse.json({
    message: assistantRow.content,
    page_citation: assistantRow.page_citation,
    created_at: assistantRow.created_at,
  })
}
