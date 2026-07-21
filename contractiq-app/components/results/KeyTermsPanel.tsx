'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KeyTermRow } from './KeyTermRow'
import type { KeyTerm } from './key-term-types'

interface KeyTermsPanelProps {
  contractId: string
  onTermPageClick: (term: KeyTerm) => void
}

export function KeyTermsPanel({ contractId, onTermPageClick }: KeyTermsPanelProps) {
  const supabase = useMemo(() => createClient(), [])
  const [terms, setTerms] = useState<KeyTerm[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('key_terms')
        .select('*')
        .eq('contract_id', contractId)
        .order('is_custom', { ascending: true })
        .order('created_at')

      if (cancelled) return

      if (fetchError) {
        setError("Couldn't load key terms — try refreshing the page.")
        return
      }

      setTerms(data as KeyTerm[])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [contractId, supabase])

  function handleUpdate(updated: KeyTerm) {
    setTerms((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev)
  }

  if (error) {
    return <div className="type-body-lg p-6 text-red-500">{error}</div>
  }

  if (terms === null) {
    return <div className="type-body-lg p-6 text-grey-500">Loading key terms…</div>
  }

  if (terms.length === 0) {
    return <div className="type-body-lg p-6 text-grey-500">No key terms were extracted for this contract.</div>
  }

  return (
    <div className="flex flex-col overflow-y-auto p-6">
      {terms.map((term) => (
        <KeyTermRow key={term.id} term={term} onPageClick={onTermPageClick} onUpdate={handleUpdate} />
      ))}
    </div>
  )
}
