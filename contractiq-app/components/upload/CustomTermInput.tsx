'use client'

const MAX_TERMS = 5
const MAX_LENGTH = 100

interface CustomTermInputProps {
  terms: string[]
  onChange: (terms: string[]) => void
  disabled?: boolean
}

export function CustomTermInput({ terms, onChange, disabled }: CustomTermInputProps) {
  function updateTerm(index: number, value: string) {
    const next = [...terms]
    next[index] = value.slice(0, MAX_LENGTH)
    onChange(next)
  }

  function removeTerm(index: number) {
    onChange(terms.filter((_, i) => i !== index))
  }

  function addTerm() {
    if (terms.length >= MAX_TERMS) return
    onChange([...terms, ''])
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="type-body-sm text-grey-500">Custom key terms (optional, up to {MAX_TERMS})</span>

      {terms.map((term, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="text"
            value={term}
            disabled={disabled}
            onChange={(e) => updateTerm(index, e.target.value)}
            placeholder="e.g. Non-compete radius"
            maxLength={MAX_LENGTH}
            className="type-body-lg flex-1 rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => removeTerm(index)}
            disabled={disabled}
            className="type-body-sm text-grey-500 hover:text-red-500"
            aria-label={`Remove custom term ${index + 1}`}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addTerm}
        disabled={disabled || terms.length >= MAX_TERMS}
        className="type-body-sm self-start text-blue-500 disabled:cursor-not-allowed disabled:text-grey-300"
      >
        + Add Key Term
      </button>
    </div>
  )
}
