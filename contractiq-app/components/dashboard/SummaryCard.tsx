interface SummaryCardProps {
  contracts: Array<{ contract_type: string }>
}

export function SummaryCard({ contracts }: SummaryCardProps) {
  const total = contracts.length
  const ndaCount = contracts.filter((c) => c.contract_type === 'NDA').length
  const msaCount = contracts.filter((c) => c.contract_type === 'MSA').length

  return (
    <div className="flex gap-8 rounded-lg border border-grey-100 bg-white p-6">
      <Stat label="Total Contracts" value={total} />
      <Stat label="NDAs" value={ndaCount} />
      <Stat label="MSAs" value={msaCount} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="type-h5 text-grey-900">{value}</span>
      <span className="type-body-sm text-grey-500">{label}</span>
    </div>
  )
}
