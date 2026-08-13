export type ContractType = 'NDA' | 'MSA'

export const STANDARD_TERMS: Record<ContractType, string[]> = {
  NDA: [
    'Parties',
    'Effective Date',
    'Confidentiality Obligations',
    'Permitted Disclosures',
    'Term & Duration',
    'Governing Law',
    'Jurisdiction',
    'IP Ownership',
    'Non-Solicitation',
    'Breach & Remedy',
  ],
  MSA: [
    'Parties',
    'Service Scope',
    'Payment Terms',
    'Invoice Schedule',
    'Late Payment Penalty',
    'Liability Cap',
    'Indemnification',
    'IP Ownership',
    'Termination Clause',
    'Governing Law',
    'Dispute Resolution',
    'Notice Period',
  ],
}

export interface ExtractedTermRaw {
  term_name: string
  value: string
  page_number: number
  confidence_score: number
  source_sentence: string
}

export interface ExtractKeyTermsToolInput {
  terms: ExtractedTermRaw[]
}

// The Azure agent has no forced tool-calling — it can only be asked, in plain
// text, to emit JSON matching this shape and hope it complies.
export const JSON_RESPONSE_INSTRUCTIONS =
  'Respond with a single JSON object and nothing else — no markdown code fences, no commentary before or ' +
  'after it. The object must have this exact shape:\n' +
  '{"terms": [{"term_name": string, "value": string, "page_number": integer >= 1, "confidence_score": number ' +
  '0-100, "source_sentence": string}, ...]}\n' +
  'Include one entry per target term listed below, in the same order.'

export const JSON_PARSE_RETRY_REMINDER =
  'Your previous response could not be parsed as JSON matching the required shape. Respond with ONLY the raw ' +
  'JSON object — no markdown code fences, no explanation, no leading or trailing text.'

const NDA_EXAMPLES = `Example 1 — value clearly stated:
Excerpt (page 2): "This Agreement is effective as of March 1, 2025 (the "Effective Date")."
Extraction: term_name: "Effective Date", value: "March 1, 2025", page_number: 2, confidence_score: 98, source_sentence: "This Agreement is effective as of March 1, 2025 (the \\"Effective Date\\")."

Example 2 — value requires light inference:
Excerpt (page 5): "Any dispute arising under this Agreement shall be resolved in the state and federal courts located in Delaware, and this Agreement shall be construed in accordance with the laws of the State of Delaware."
Extraction: term_name: "Governing Law", value: "State of Delaware", page_number: 5, confidence_score: 90, source_sentence: "This Agreement shall be construed in accordance with the laws of the State of Delaware."

Example 3 — term genuinely absent, never omitted:
The document contains no clause restricting either party from soliciting the other's employees or clients.
Extraction: term_name: "Non-Solicitation", value: "Not found in document", page_number: 1, confidence_score: 0, source_sentence: "Not found in document"`

const MSA_EXAMPLES = `Example 1 — value clearly stated:
Excerpt (page 3): "Client shall pay all undisputed invoices within thirty (30) days of receipt (\"Net 30\")."
Extraction: term_name: "Payment Terms", value: "Net 30 days", page_number: 3, confidence_score: 97, source_sentence: "Client shall pay all undisputed invoices within thirty (30) days of receipt (\\"Net 30\\")."

Example 2 — value requires light inference:
Excerpt (page 6): "In no event shall either party's aggregate liability under this Agreement exceed the total fees paid by Client in the twelve (12) months preceding the claim."
Extraction: term_name: "Liability Cap", value: "Total fees paid in the preceding 12 months", page_number: 6, confidence_score: 88, source_sentence: "In no event shall either party's aggregate liability under this Agreement exceed the total fees paid by Client in the twelve (12) months preceding the claim."

Example 3 — term genuinely absent, never omitted:
The document does not specify any advance notice period for routine communications between the parties.
Extraction: term_name: "Notice Period", value: "Not found in document", page_number: 1, confidence_score: 0, source_sentence: "Not found in document"`

const EXTRACTION_INSTRUCTIONS =
  'For each term in the target list below, find its value in the contract text. Use the [PAGE N] markers ' +
  'in the text to determine page_number. Quote the exact sentence you drew the value from as source_sentence. ' +
  'Self-report a confidence_score (0-100) reflecting how certain you are the extracted value is correct and ' +
  'complete. If a term is genuinely absent from the document, still return it with value: "Not found in ' +
  'document" and confidence_score: 0 — do not omit it.'

export function buildSystemPrompt(contractType: ContractType, targetTerms: string[]): string {
  const examples = contractType === 'NDA' ? NDA_EXAMPLES : MSA_EXAMPLES

  return [
    `You are a contract analysis assistant extracting specific terms from a ${contractType}.`,
    EXTRACTION_INSTRUCTIONS,
    `Target terms:\n${targetTerms.map((term) => `- ${term}`).join('\n')}`,
    examples,
  ].join('\n\n')
}
