'use client'

import type { ChatMessage } from './chat-types'

const CITATION_PATTERN = /\[Page\s+(\d+)\]/i

interface ChatMessageListProps {
  messages: ChatMessage[]
  onCitationClick: (pageNumber: number) => void
  typing: boolean
}

export function ChatMessageList({ messages, onCitationClick, typing }: ChatMessageListProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} onCitationClick={onCitationClick} />
      ))}
      {typing && <div className="type-body-sm w-fit rounded-md bg-grey-50 px-3 py-2 text-grey-500">Typing…</div>}
    </div>
  )
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage
  onCitationClick: (pageNumber: number) => void
}) {
  const isUser = message.role === 'user'
  const match = message.content.match(CITATION_PATTERN)
  const bodyText = match && message.page_citation !== null ? message.content.slice(0, match.index).trim() : message.content

  return (
    <div
      className={`type-body-lg flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2 ${
        isUser ? 'self-end bg-blue-500 text-white' : 'self-start bg-grey-50 text-grey-900'
      }`}
    >
      <p className="whitespace-pre-wrap">{bodyText}</p>
      {message.page_citation !== null && (
        <button
          type="button"
          onClick={() => onCitationClick(message.page_citation!)}
          className="type-body-sm w-fit text-blue-500 underline hover:text-blue-700"
        >
          [Page {message.page_citation}]
        </button>
      )}
    </div>
  )
}
