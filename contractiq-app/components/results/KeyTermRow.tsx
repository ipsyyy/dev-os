'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { KeyTerm } from './key-term-types'

const CONFIDENCE_HIGH = 80
const CONFIDENCE_MEDIUM = 50
const MAX_VALUE_LENGTH = 2000

type ConfidenceTier = 'high' | 'medium' | 'low'

function confidenceTier(score: number): ConfidenceTier {
  if (score >= CONFIDENCE_HIGH) return 'high'
  if (score >= CONFIDENCE_MEDIUM) return 'medium'
  return 'low'
}

interface KeyTermRowProps {
  term: KeyTerm
  onPageClick: (term: KeyTerm) => void
  // Row owns its own save call (direct Supabase write, per spec §5) but the
  // fetched list lives in the parent panel — this keeps that list in sync
  // after an optimistic update, a confirmed save, or a reverted failure.
  onUpdate: (term: KeyTerm) => void
}

export function KeyTermRow({ term, onPageClick, onUpdate }: KeyTermRowProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(term.current_value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const [tooltipTriggered, setTooltipTriggered] = useState(false)

  const tier = confidenceTier(term.confidence_score)

  async function handleSave() {
    const trimmed = draftValue.trim()

    if (!trimmed) {
      setDraftValue(term.current_value)
      setIsEditing(false)
      return
    }
    if (trimmed === term.current_value) {
      setIsEditing(false)
      return
    }

    setSaving(true)
    setSaveError(null)

    const editedAt = new Date().toISOString()
    onUpdate({ ...term, current_value: trimmed, is_edited: true, edited_at: editedAt })

    const { error } = await supabase
      .from('key_terms')
      .update({ current_value: trimmed, is_edited: true, edited_at: editedAt })
      .eq('id', term.id)

    setSaving(false)

    if (error) {
      onUpdate(term)
      setDraftValue(term.current_value)
      setSaveError("Couldn't save — try again")
      return
    }

    setIsEditing(false)
  }

  function handleLowConfidenceOpen() {
    if (tier === 'low' && !tooltipTriggered) {
      setTooltipTriggered(true)
      onPageClick(term)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-grey-50 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="type-body-lg text-grey-900">{term.term_name}</span>
          {term.is_custom && (
            <span className="type-body-sm rounded-sm border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">
              Custom
            </span>
          )}
          {term.is_edited && (
            <span
              className="type-body-sm rounded-sm border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700"
              title={`Original AI value: ${term.ai_value}`}
            >
              Edited
            </span>
          )}
        </div>

        <button type="button" onClick={() => onPageClick(term)} className="type-body-sm shrink-0 text-blue-500 hover:underline">
          Page {term.page_number}
        </button>
      </div>

      <div>
        {isEditing ? (
          <input
            type="text"
            value={draftValue}
            maxLength={MAX_VALUE_LENGTH}
            disabled={saving}
            autoFocus
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
              if (e.key === 'Escape') {
                setDraftValue(term.current_value)
                setIsEditing(false)
              }
            }}
            className="type-body-lg w-full rounded-md border border-blue-500 px-3 py-1.5 text-grey-900 outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftValue(term.current_value)
              setIsEditing(true)
            }}
            className="type-body-lg block w-full rounded-md px-3 py-1.5 text-left text-grey-900 hover:bg-grey-50"
          >
            {term.current_value}
          </button>
        )}
        {saveError && <p className="type-body-sm mt-1 text-red-500">{saveError}</p>}
      </div>

      <div className="flex items-center gap-3">
        <ConfidenceBadge score={term.confidence_score} tier={tier} onOpen={handleLowConfidenceOpen} />
        <button type="button" onClick={() => setShowWhy((s) => !s)} className="type-body-sm text-grey-500 hover:text-grey-900">
          {showWhy ? 'Hide' : 'Why?'}
        </button>
      </div>

      {showWhy && (
        <blockquote className="type-body-sm border-l-2 border-grey-200 pl-3 text-grey-500">
          &ldquo;{term.source_sentence}&rdquo;
        </blockquote>
      )}
    </div>
  )
}

function ConfidenceBadge({ score, tier, onOpen }: { score: number; tier: ConfidenceTier; onOpen: () => void }) {
  const colorClasses: Record<ConfidenceTier, string> = {
    high: 'border-green-200 bg-green-50 text-green-700',
    medium: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    low: 'border-red-200 bg-red-50 text-red-700',
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`type-body-sm rounded-sm border px-2 py-0.5 ${colorClasses[tier]}`}>{Math.round(score)}%</span>
      {tier === 'low' && (
        <span className="group relative inline-flex items-center" onMouseEnter={onOpen} onFocus={onOpen} tabIndex={0}>
          <span aria-hidden="true">⚠️</span>
          <span
            role="tooltip"
            className="type-body-sm pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-56 -translate-x-1/2 rounded-md border border-grey-100 bg-white p-2 text-grey-900 opacity-0 shadow-sm transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus:opacity-100"
          >
            Low confidence — we recommend verifying this in the document directly.
          </span>
        </span>
      )}
    </span>
  )
}
