export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  page_citation: number | null
  created_at: string
}
