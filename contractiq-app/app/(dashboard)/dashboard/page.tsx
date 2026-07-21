import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SummaryCard } from '@/components/dashboard/SummaryCard'
import { ContractHistoryTable } from '@/components/dashboard/ContractHistoryTable'

export default async function DashboardPage() {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, name, contract_type, status, created_at')
    .order('created_at', { ascending: false })

  const hasContracts = (contracts?.length ?? 0) > 0

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 font-sans">
      <div className="flex items-center justify-between">
        <h1 className="type-h5 text-grey-900">Dashboard</h1>
        <Link
          href="/contracts/new"
          className="type-body-lg rounded-md bg-blue-500 px-6 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02]"
        >
          Review a Contract
        </Link>
      </div>

      {hasContracts ? (
        <>
          <SummaryCard contracts={contracts!} />
          <ContractHistoryTable contracts={contracts!} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-grey-100 bg-white px-4 py-24 text-center">
          <p className="type-body-lg text-grey-500">No contracts reviewed yet — upload your first contract to begin</p>
          <Link
            href="/contracts/new"
            className="type-body-lg rounded-md bg-blue-500 px-6 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02]"
          >
            Review a Contract
          </Link>
        </div>
      )}
    </main>
  )
}
