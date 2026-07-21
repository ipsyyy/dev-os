'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const MAX_COMMENT_LENGTH = 500

type Rating = 'up' | 'down'

export function FeedbackWidget({ contractId }: { contractId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [rating, setRating] = useState<Rating | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function checkExisting() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('user_feedback')
        .select('id')
        .eq('contract_id', contractId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!cancelled) {
        setSubmitted(!!data)
        setLoading(false)
      }
    }

    checkExisting()
    return () => {
      cancelled = true
    }
  }, [contractId, supabase])

  async function handleSubmit() {
    if (!rating) return
    setSubmitting(true)
    setSubmitError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setSubmitting(false)
      setSubmitError("Couldn't submit feedback — try again")
      return
    }

    const { error } = await supabase.from('user_feedback').insert({
      user_id: user.id,
      contract_id: contractId,
      rating,
      comment: comment.trim() || null,
    })

    setSubmitting(false)

    if (error) {
      setSubmitError("Couldn't submit feedback — try again")
      return
    }

    setSubmitted(true)
  }

  if (loading) return null

  if (submitted) {
    return <p className="type-body-sm text-grey-500">Thanks for your feedback!</p>
  }

  return (
    <div className="flex items-center gap-3">
      <span className="type-body-sm text-grey-500">Was this helpful?</span>
      <button
        type="button"
        onClick={() => setRating('up')}
        aria-pressed={rating === 'up'}
        aria-label="Thumbs up"
        className={`rounded-md border px-2 py-1 text-base leading-none ${
          rating === 'up' ? 'border-blue-500 bg-blue-50' : 'border-grey-100 hover:bg-grey-50'
        }`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => setRating('down')}
        aria-pressed={rating === 'down'}
        aria-label="Thumbs down"
        className={`rounded-md border px-2 py-1 text-base leading-none ${
          rating === 'down' ? 'border-blue-500 bg-blue-50' : 'border-grey-100 hover:bg-grey-50'
        }`}
      >
        👎
      </button>

      {rating && (
        <>
          <input
            type="text"
            value={comment}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment"
            className="type-body-sm w-48 rounded-md border border-grey-100 px-2 py-1 text-grey-900 outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="type-body-sm rounded-md bg-blue-500 px-3 py-1 text-white disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </>
      )}

      {submitError && <span className="type-body-sm text-red-500">{submitError}</span>}
    </div>
  )
}
