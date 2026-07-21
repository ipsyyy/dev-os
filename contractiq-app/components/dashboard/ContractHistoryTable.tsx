'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Contract {
  id: string
  name: string
  contract_type: string
  status: string
  created_at: string
}

type SortColumn = 'name' | 'contract_type' | 'created_at'

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  uploaded: { label: 'Pending', classes: 'border-grey-200 bg-grey-50 text-grey-700' },
  processing: { label: 'Processing…', classes: 'border-blue-200 bg-blue-50 text-blue-700' },
  completed: { label: 'Reviewed', classes: 'border-green-200 bg-green-50 text-green-700' },
  error: { label: 'Failed', classes: 'border-red-200 bg-red-50 text-red-700' },
}

export function ContractHistoryTable({ contracts }: { contracts: Contract[] }) {
  const router = useRouter()
  const [sortColumn, setSortColumn] = useState<SortColumn>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const copy = [...contracts]
    copy.sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return copy
  }, [contracts, sortColumn, sortDirection])

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  function SortHeader({ column, label }: { column: SortColumn; label: string }) {
    const isActive = sortColumn === column
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="type-body-sm flex items-center gap-1 text-grey-500 hover:text-grey-900"
      >
        {label}
        {isActive && <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
      </button>
    )
  }

  return (
    <table className="w-full border-collapse overflow-hidden rounded-lg border border-grey-100 bg-white">
      <thead>
        <tr className="border-b border-grey-100 bg-grey-25">
          <th className="px-4 py-3 text-left">
            <SortHeader column="name" label="Name" />
          </th>
          <th className="px-4 py-3 text-left">
            <SortHeader column="contract_type" label="Type" />
          </th>
          <th className="px-4 py-3 text-left">
            <SortHeader column="created_at" label="Date" />
          </th>
          <th className="type-body-sm px-4 py-3 text-left text-grey-500">Status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((contract) => {
          const badge = STATUS_BADGE[contract.status] ?? STATUS_BADGE.uploaded
          return (
            <tr
              key={contract.id}
              onClick={() => router.push(`/contracts/${contract.id}`)}
              className="type-body-lg cursor-pointer border-b border-grey-50 text-grey-900 last:border-b-0 hover:bg-grey-25"
            >
              <td className="max-w-xs truncate px-4 py-3" title={contract.name}>
                {contract.name}
              </td>
              <td className="px-4 py-3">{contract.contract_type}</td>
              <td className="type-body-sm px-4 py-3 text-grey-500">
                {new Date(contract.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                <span className={`type-body-sm rounded-sm border px-2 py-0.5 ${badge.classes}`}>{badge.label}</span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
