import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ResultsView } from './results-view'

export default async function ContractResultsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  // RLS scopes this to the caller's own contracts, so a non-owner's request
  // for someone else's id comes back null — same anti-enumeration pattern as
  // POST /api/contracts/[id]/process, so notFound() covers both cases at once.
  const { data: contract } = await supabase.from('contracts').select('*').eq('id', params.id).maybeSingle()

  if (!contract) {
    notFound()
  }

  return <ResultsView contract={contract} />
}
