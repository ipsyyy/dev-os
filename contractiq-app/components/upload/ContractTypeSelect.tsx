'use client'

export type ContractTypeValue = 'NDA' | 'MSA'

interface ContractTypeSelectProps {
  value: ContractTypeValue | null
  onChange: (value: ContractTypeValue) => void
  disabled?: boolean
}

export function ContractTypeSelect({ value, onChange, disabled }: ContractTypeSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="contract-type" className="type-body-sm text-grey-500">
        Contract type
      </label>
      <select
        id="contract-type"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ContractTypeValue)}
        className="type-body-lg rounded-md border border-grey-100 bg-white px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
      >
        <option value="" disabled>
          Select a contract type
        </option>
        <option value="NDA">NDA — Non-Disclosure Agreement</option>
        <option value="MSA">MSA — Master Service Agreement</option>
      </select>
    </div>
  )
}
