import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractText } from '@/lib/pdf/extract-text'
import { STANDARD_TERMS, type ContractType } from '@/lib/claude/extraction-prompt'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_PAGES = 20
const MAX_TOKENS = 15000
const MAX_CUSTOM_TERMS = 5
const MAX_CUSTOM_TERM_LENGTH = 100

function errorResponse(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, ...(message ? { message } : {}) } }, { status })
}

function parseCustomTerms(
  raw: FormDataEntryValue | null,
  contractType: ContractType
): { terms: string[] } | { error: NextResponse } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { terms: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      error: errorResponse(400, 'invalid_custom_terms', 'Custom terms were malformed. Please try again.'),
    }
  }

  const isValidShape =
    Array.isArray(parsed) &&
    parsed.length <= MAX_CUSTOM_TERMS &&
    parsed.every(
      (term) =>
        typeof term === 'string' && term.trim().length > 0 && term.trim().length <= MAX_CUSTOM_TERM_LENGTH
    )

  if (!isValidShape) {
    return {
      error: errorResponse(
        400,
        'invalid_custom_terms',
        'Custom terms must be 1–5 non-empty entries, each under 100 characters.'
      ),
    }
  }

  // Dedupe case-insensitively — only unique entries count toward the cap.
  const seen = new Set<string>()
  const terms = (parsed as string[])
    .map((term) => term.trim())
    .filter((term) => {
      const key = term.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const standardTermsLower = STANDARD_TERMS[contractType].map((t) => t.toLowerCase())
  const duplicate = terms.find((term) => standardTermsLower.includes(term.toLowerCase()))
  if (duplicate) {
    return {
      error: errorResponse(
        400,
        'custom_term_duplicates_standard',
        `"${duplicate}" is already part of the standard extraction.`
      ),
    }
  }

  return { terms }
}

export async function POST(request: Request) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return errorResponse(401, 'unauthorized', 'Authentication required')
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const contractTypeValue = formData.get('contract_type')

  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return errorResponse(400, 'invalid_file_type', 'Only PDF files are supported.')
  }
  if (file.size > MAX_FILE_SIZE) {
    return errorResponse(400, 'file_too_large', 'File must be 10MB or smaller.')
  }
  if (contractTypeValue !== 'NDA' && contractTypeValue !== 'MSA') {
    return errorResponse(400, 'invalid_contract_type', 'Select a contract type (NDA or MSA).')
  }
  const contractType = contractTypeValue as ContractType

  const customTermsResult = parseCustomTerms(formData.get('custom_terms'), contractType)
  if ('error' in customTermsResult) {
    return customTermsResult.error
  }
  const customTerms = customTermsResult.terms

  const buffer = Buffer.from(await file.arrayBuffer())

  let extracted: { text: string; pageCount: number }
  try {
    extracted = await extractText(buffer)
  } catch {
    return errorResponse(
      500,
      'upload_failed',
      "We couldn't read this PDF — try re-exporting it and uploading again."
    )
  }

  const wordCount = extracted.text.trim().split(/\s+/).filter(Boolean).length
  if (wordCount < 100) {
    return errorResponse(422, 'scanned_pdf_not_supported', 'Scanned PDFs are not supported yet.')
  }
  if (extracted.pageCount > MAX_PAGES) {
    return errorResponse(422, 'too_many_pages', 'Contracts longer than 20 pages are not supported yet.')
  }
  const estimatedTokens = Math.ceil(extracted.text.length / 4)
  if (estimatedTokens > MAX_TOKENS) {
    return errorResponse(
      422,
      'token_limit_exceeded',
      'This contract is too long for analysis (max ~15,000 tokens / 20 pages).'
    )
  }

  const contractId = randomUUID()
  const storagePath = `${user.id}/${contractId}/document.pdf`

  let filePath: string | null = storagePath
  const { error: storageError } = await supabase.storage
    .from('contracts')
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false })

  if (storageError) {
    console.warn(`Storage upload failed for contract ${contractId}:`, storageError.message)
    filePath = null
  }

  const { error: insertError } = await supabase.from('contracts').insert({
    id: contractId,
    user_id: user.id,
    name: file.name,
    contract_type: contractType,
    file_path: filePath,
    contract_text: extracted.text,
    page_count: extracted.pageCount,
    status: 'uploaded',
  })

  if (insertError) {
    return errorResponse(500, 'upload_failed', 'Something went wrong while saving your contract. Please try again.')
  }

  if (customTerms.length > 0) {
    const { error: customTermsError } = await supabase
      .from('custom_key_terms')
      .insert(customTerms.map((term_name) => ({ contract_id: contractId, term_name })))

    if (customTermsError) {
      // Don't leave an orphaned contract row missing the custom terms the user asked for.
      await supabase.from('contracts').delete().eq('id', contractId)
      return errorResponse(500, 'upload_failed', 'Something went wrong while saving your contract. Please try again.')
    }
  }

  return NextResponse.json(
    {
      contract_id: contractId,
      status: 'uploaded',
      standard_terms_preview: STANDARD_TERMS[contractType],
      custom_terms: customTerms,
    },
    { status: 201 }
  )
}
