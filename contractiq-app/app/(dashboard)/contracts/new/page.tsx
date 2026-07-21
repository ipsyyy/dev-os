'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ContractTypeSelect, type ContractTypeValue } from '@/components/upload/ContractTypeSelect'
import { UploadDropzone } from '@/components/upload/UploadDropzone'
import { CustomTermInput } from '@/components/upload/CustomTermInput'

interface UploadResult {
  contract_id: string
  standard_terms_preview: string[]
  custom_terms: string[]
}

export default function NewContractPage() {
  const router = useRouter()

  const [contractType, setContractType] = useState<ContractTypeValue | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [customTerms, setCustomTerms] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)

  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (!contractType) {
      setSubmitError('Select a contract type.')
      return
    }
    if (!file) {
      setSubmitError('Choose a PDF to upload.')
      return
    }

    const trimmedTerms = customTerms.map((term) => term.trim()).filter(Boolean)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('contract_type', contractType)
    if (trimmedTerms.length > 0) {
      formData.append('custom_terms', JSON.stringify(trimmedTerms))
    }

    setSubmitting(true)
    const response = await fetch('/api/contracts/upload', { method: 'POST', body: formData })
    const body = await response.json()
    setSubmitting(false)

    if (!response.ok) {
      setSubmitError(body?.error?.message ?? 'Something went wrong. Please try again.')
      return
    }

    setResult(body)
  }

  async function handleProcess() {
    if (!result) return
    setProcessError(null)
    setProcessing(true)

    const response = await fetch(`/api/contracts/${result.contract_id}/process`, { method: 'POST' })

    if (!response.ok) {
      setProcessing(false)
      const body = await response.json().catch(() => null)
      setProcessError(body?.error?.message ?? "Couldn't start processing. Please try again.")
      return
    }

    router.push(`/contracts/${result.contract_id}`)
  }

  if (result) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-grey-25 px-4 py-24 font-sans">
        <h1 className="type-h5 text-grey-900">Ready to review</h1>
        <p className="type-body-lg text-grey-500">
          Here&apos;s what we&apos;ll extract from this {contractType}. Click &quot;Process Contract&quot; to
          run the analysis.
        </p>

        <ul className="flex flex-col gap-2 rounded-lg border border-grey-100 bg-white p-4">
          {result.standard_terms_preview.map((term) => (
            <li key={term} className="type-body-lg flex items-center justify-between text-grey-900">
              {term}
            </li>
          ))}
          {result.custom_terms.map((term) => (
            <li key={term} className="type-body-lg flex items-center justify-between text-grey-900">
              {term}
              <span className="type-body-sm rounded-sm border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">
                Custom
              </span>
            </li>
          ))}
        </ul>

        {processError && <p className="type-body-sm text-red-500">{processError}</p>}

        <button
          type="button"
          onClick={handleProcess}
          disabled={processing}
          className="type-body-lg w-full rounded-md bg-blue-500 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400 disabled:hover:scale-100"
        >
          {processing ? 'Starting…' : 'Process Contract'}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-grey-25 px-4 py-24 font-sans">
      <h1 className="type-h5 text-grey-900">Upload a contract</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-lg border border-grey-100 bg-white p-6">
        <ContractTypeSelect value={contractType} onChange={setContractType} disabled={submitting} />

        <UploadDropzone
          file={file}
          disabled={!contractType || submitting}
          onFileSelected={(picked, error) => {
            setFile(picked)
            setFileError(error)
          }}
        />
        {fileError && <p className="type-body-sm -mt-4 text-red-500">{fileError}</p>}

        <CustomTermInput terms={customTerms} onChange={setCustomTerms} disabled={submitting} />

        {submitError && <p className="type-body-sm text-red-500">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting || !contractType || !file}
          className="type-body-lg w-full rounded-md bg-blue-500 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400 disabled:hover:scale-100"
        >
          {submitting ? 'Uploading…' : 'Upload'}
        </button>
      </form>
    </main>
  )
}
