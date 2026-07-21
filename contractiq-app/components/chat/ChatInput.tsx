'use client'

import { useState, type FormEvent } from 'react'

const MAX_LENGTH = 2000

interface ChatInputProps {
  onSubmit: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSubmit, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-grey-100 p-3">
      <input
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask about this contract…"
        className="type-body-lg flex-1 rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="type-body-sm rounded-md bg-blue-500 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400"
      >
        Send
      </button>
    </form>
  )
}
