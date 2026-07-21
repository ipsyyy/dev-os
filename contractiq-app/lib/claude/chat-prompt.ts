export type QueryClassification = 'contract' | 'history' | 'both'

const HISTORY_PATTERN = /\b(earlier|before|previously|you (said|mentioned|told)|what did (i|you) (ask|say))\b/i
const CONTRACT_KEYWORD_PATTERN = /\b(clause|section|term|contract|agreement|page)\b/i

export function classifyQuery(message: string): QueryClassification {
  if (HISTORY_PATTERN.test(message)) {
    return CONTRACT_KEYWORD_PATTERN.test(message) ? 'both' : 'history'
  }
  return 'contract'
}

const BASE_SYSTEM_PROMPT =
  'Answer only from the document text provided. If the answer is not in the document, say so — respond exactly ' +
  '"I cannot find this in the document." Prefix every substantive answer with "Based on the document, ...". ' +
  'Every answer that draws from the contract must end with a citation in the exact format [Page X] where X is ' +
  'the page number the information came from.'

const HISTORY_AWARENESS_LINE =
  'The user may be referring to earlier turns in this conversation. Use the conversation history to answer, but ' +
  'still ground any contract-related claims in the document text and cite the page.'

export const CITATION_RETRY_REMINDER =
  "Your response must end with either a [Page X] citation or the exact fallback phrase 'I cannot find this in " +
  "the document.' Regenerate your answer."

const FALLBACK_PHRASE = 'i cannot find this in the document'
const CITATION_PATTERN = /\[Page\s+(\d+)\]/i

export function buildChatSystemPrompt(contractText: string, classification: QueryClassification): string {
  const parts = [BASE_SYSTEM_PROMPT]
  if (classification === 'history' || classification === 'both') {
    parts.push(HISTORY_AWARENESS_LINE)
  }
  parts.push(`Document text:\n${contractText}`)
  return parts.join('\n\n')
}

export interface CitationResult {
  valid: boolean
  pageCitation: number | null
}

export function validateCitation(responseText: string): CitationResult {
  if (responseText.toLowerCase().includes(FALLBACK_PHRASE)) {
    return { valid: true, pageCitation: null }
  }
  const match = responseText.match(CITATION_PATTERN)
  if (match) {
    return { valid: true, pageCitation: Number(match[1]) }
  }
  return { valid: false, pageCitation: null }
}
