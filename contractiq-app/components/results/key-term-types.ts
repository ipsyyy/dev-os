export interface KeyTerm {
  id: string
  term_name: string
  ai_value: string
  current_value: string
  page_number: number
  confidence_score: number
  source_sentence: string
  is_custom: boolean
  is_edited: boolean
  edited_at: string | null
}
