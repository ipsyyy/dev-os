import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClaudeClient, CLAUDE_MODEL } from '@/lib/claude/client'
import {
  STANDARD_TERMS,
  EXTRACT_KEY_TERMS_TOOL,
  TOOL_PARSE_RETRY_REMINDER,
  buildSystemPrompt,
  type ContractType,
  type ExtractedTermRaw,
  type ExtractKeyTermsToolInput,
} from '@/lib/claude/extraction-prompt'

const MAX_TOKENS = 15000
const RETRY_DELAYS_MS = [1000, 2000, 4000]

function errorResponse(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, ...(message ? { message } : {}) } }, { status })
}

class ToolParseError extends Error {}

function parseToolInput(input: unknown): ExtractKeyTermsToolInput | null {
  if (typeof input === 'object' && input !== null && Array.isArray((input as { terms?: unknown }).terms)) {
    return input as ExtractKeyTermsToolInput
  }
  return null
}

async function callExtractionTool(
  client: Anthropic,
  baseSystemPrompt: string,
  contractText: string
): Promise<ExtractKeyTermsToolInput> {
  let systemPrompt = baseSystemPrompt
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]))
    }

    try {
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        // `temperature` is deprecated/rejected for claude-sonnet-5 — omitted, not just defaulted.
        system: systemPrompt,
        tools: [EXTRACT_KEY_TERMS_TOOL],
        tool_choice: { type: 'tool', name: 'extract_key_terms' },
        messages: [{ role: 'user', content: contractText }],
      })

      const toolUse = response.content.find((block) => block.type === 'tool_use')
      const parsed = toolUse && parseToolInput(toolUse.input)
      if (!parsed) {
        throw new ToolParseError('Response did not include a valid extract_key_terms call')
      }

      return parsed
    } catch (err) {
      lastError = err
      // Only the parse-failure retry gets the schema reminder — API/network
      // failures are retried with the prompt unchanged, per spec §3 step 6.
      if (err instanceof ToolParseError) {
        systemPrompt = `${baseSystemPrompt}\n\n${TOOL_PARSE_RETRY_REMINDER}`
      }
    }
  }

  throw lastError
}

function validateTerms(raw: unknown, targetTermsLower: Set<string>, pageCount: number): ExtractedTermRaw[] {
  if (!Array.isArray(raw)) return []

  return raw.filter((term): term is ExtractedTermRaw => {
    if (
      !term ||
      typeof term.term_name !== 'string' ||
      typeof term.value !== 'string' ||
      typeof term.page_number !== 'number' ||
      typeof term.confidence_score !== 'number' ||
      typeof term.source_sentence !== 'string'
    ) {
      return false
    }
    if (!targetTermsLower.has(term.term_name.trim().toLowerCase())) return false
    if (term.confidence_score < 0 || term.confidence_score > 100) return false
    if (term.page_number < 1 || term.page_number > pageCount) return false
    return true
  })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const contractId = params.id
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'unauthorized', 'Authentication required')
  }

  // RLS scopes this to the caller's own rows, so a contract that exists but
  // belongs to someone else is indistinguishable from one that doesn't exist
  // at all — both come back null here, which is what we want (no existence
  // leak to non-owners, matching the anti-enumeration pattern in auth-spec.md).
  const { data: contract } = await supabase.from('contracts').select('*').eq('id', contractId).maybeSingle()

  if (!contract) {
    return errorResponse(404, 'not_found', 'Contract not found.')
  }

  if (contract.status === 'processing') {
    return errorResponse(409, 'already_processing', 'This contract is already being processed.')
  }
  if (contract.status === 'completed') {
    return errorResponse(409, 'already_completed', 'This contract has already been processed.')
  }

  await supabase.from('contracts').update({ status: 'processing' }).eq('id', contractId)

  async function fail(status: number, code: string, message: string) {
    await supabase.from('contracts').update({ status: 'error', error_message: message }).eq('id', contractId)
    return errorResponse(status, code, message)
  }

  try {
    const estimatedTokens = Math.ceil((contract.contract_text ?? '').length / 4)
    if (estimatedTokens > MAX_TOKENS) {
      return await fail(413, 'token_limit_exceeded', 'This contract is too long for analysis.')
    }

    const { data: customTerms } = await supabase
      .from('custom_key_terms')
      .select('term_name')
      .eq('contract_id', contractId)

    const customTermNames = (customTerms ?? []).map((row) => row.term_name)
    const contractType = contract.contract_type as ContractType
    const targetTerms = [...STANDARD_TERMS[contractType], ...customTermNames]
    const targetTermsLower = new Set(targetTerms.map((term) => term.trim().toLowerCase()))
    const customTermNamesLower = new Set(customTermNames.map((term) => term.trim().toLowerCase()))

    const systemPrompt = buildSystemPrompt(contractType, targetTerms)
    const client = createClaudeClient()

    let toolInput: ExtractKeyTermsToolInput
    try {
      toolInput = await callExtractionTool(client, systemPrompt, contract.contract_text ?? '')
    } catch {
      return await fail(502, 'ai_provider_error', "We couldn't analyze this contract right now. Try again in a few minutes.")
    }

    const validTerms = validateTerms(toolInput.terms, targetTermsLower, contract.page_count ?? Infinity)

    const rowsToInsert = validTerms.map((term) => ({
      contract_id: contractId,
      term_name: term.term_name,
      ai_value: term.value,
      current_value: term.value,
      page_number: term.page_number,
      confidence_score: term.confidence_score,
      source_sentence: term.source_sentence,
      is_custom: customTermNamesLower.has(term.term_name.trim().toLowerCase()),
    }))

    const { data: insertedRows, error: insertError } = await supabase
      .from('key_terms')
      .insert(rowsToInsert)
      .select()

    if (insertError) {
      return await fail(500, 'processing_failed', 'Something went wrong while saving the analysis. Please try again.')
    }

    await supabase.from('contracts').update({ status: 'completed' }).eq('id', contractId)

    return NextResponse.json({
      contract_id: contractId,
      status: 'completed',
      key_terms: (insertedRows ?? []).map((row) => ({
        id: row.id,
        term_name: row.term_name,
        value: row.ai_value,
        page_number: row.page_number,
        confidence_score: row.confidence_score,
        source_sentence: row.source_sentence,
        is_custom: row.is_custom,
        is_edited: row.is_edited,
      })),
    })
  } catch {
    return await fail(500, 'processing_failed', 'Something went wrong while analyzing this contract. Please try again.')
  }
}
