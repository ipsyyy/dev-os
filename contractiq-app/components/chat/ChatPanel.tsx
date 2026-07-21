'use client'

import { useEffect, useState } from 'react'
import { ChatMessageList } from './ChatMessageList'
import { ChatInput } from './ChatInput'
import type { ChatMessage } from './chat-types'

interface ChatPanelProps {
  contractId: string
  onCitationClick: (pageNumber: number) => void
}

export function ChatPanel({ contractId, onCitationClick }: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || loaded) return
    let cancelled = false

    async function load() {
      const response = await fetch(`/api/chat/${contractId}/messages`)
      if (!response.ok || cancelled) return
      const body = await response.json()
      if (!cancelled) {
        setMessages(body.messages)
        setLoaded(true)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isOpen, loaded, contractId])

  async function sendMessage(text: string) {
    setSendError(null)
    setPendingMessage(text)
    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: text,
        page_citation: null,
        created_at: new Date().toISOString(),
      },
    ])
    setTyping(true)

    const response = await fetch(`/api/chat/${contractId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })

    setTyping(false)

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      setSendError(body?.error?.message ?? "Couldn't get a response. Try again in a few minutes.")
      return
    }

    setPendingMessage(null)
    const body = await response.json()
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${body.created_at}`,
        role: 'assistant',
        content: body.message,
        page_citation: body.page_citation,
        created_at: body.created_at,
      },
    ])
  }

  function handleRetry() {
    if (pendingMessage) sendMessage(pendingMessage)
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="type-body-lg fixed bottom-6 right-6 z-20 rounded-full bg-blue-500 px-5 py-3 text-white shadow-sm transition-transform duration-100 ease-out hover:scale-[1.02]"
      >
        💬 Chat
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-20 flex h-[500px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg border border-grey-100 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-grey-100 px-4 py-3">
        <span className="type-body-lg text-grey-900">Ask about this contract</span>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label="Close chat"
          className="type-body-sm text-grey-500 hover:text-grey-900"
        >
          ✕
        </button>
      </div>

      <ChatMessageList messages={messages} onCitationClick={onCitationClick} typing={typing} />

      {sendError && (
        <div className="type-body-sm flex shrink-0 items-center justify-between gap-2 border-t border-red-100 bg-red-50 px-4 py-2 text-red-700">
          <span>{sendError}</span>
          <button type="button" onClick={handleRetry} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      <ChatInput onSubmit={sendMessage} disabled={typing} />
    </div>
  )
}
