'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { TextViewerFallback } from '@/components/results/TextViewerFallback'
import { KeyTermsPanel } from '@/components/results/KeyTermsPanel'
import { FeedbackWidget } from '@/components/results/FeedbackWidget'
import { ChatPanel } from '@/components/chat/ChatPanel'
import type { KeyTerm } from '@/components/results/key-term-types'

// pdfjs-dist touches browser-only APIs (Worker URL resolution, Canvas) at
// module scope, which breaks the server render pass — ssr:false keeps it
// out of that pass entirely.
const PdfViewer = dynamic(() => import('@/components/results/PdfViewer').then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <div className="type-body-lg flex h-full items-center justify-center text-grey-500">Loading viewer…</div>
  ),
})

interface Contract {
  id: string
  name: string
  contract_type: string
  status: string
  file_path: string | null
  contract_text: string | null
  page_count: number | null
}

export function ResultsView({ contract }: { contract: Contract }) {
  const [targetPage, setTargetPage] = useState<number | null>(null)
  const [targetSourceSentence, setTargetSourceSentence] = useState<string | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState<string | null>(null)

  function handleTermPageClick(term: KeyTerm) {
    setTargetPage(term.page_number)
    setTargetSourceSentence(term.source_sentence)
  }

  function handleCitationClick(pageNumber: number) {
    // Chat citations carry only a page number, no source sentence to
    // highlight — the viewers already treat a null sentence as page-nav-only.
    setTargetPage(pageNumber)
    setTargetSourceSentence(null)
  }

  async function handleProcess() {
    setProcessing(true)
    setProcessError(null)

    const response = await fetch(`/api/contracts/${contract.id}/process`, { method: 'POST' })

    if (!response.ok) {
      setProcessing(false)
      const body = await response.json().catch(() => null)
      setProcessError(body?.error?.message ?? "Couldn't process this contract. Try again.")
      return
    }

    // Simplest correct way to pick up the now-'completed' status and the
    // freshly-inserted key_terms rows without duplicating results-view state.
    window.location.reload()
  }

  if (contract.status === 'uploaded' || contract.status === 'error') {
    return (
      <main className="flex h-full min-h-full flex-col items-center justify-center gap-4 bg-grey-25 px-4 font-sans">
        <h1 className="type-h5 text-grey-900">{contract.name}</h1>
        <p className="type-body-lg text-grey-500">
          {contract.status === 'error' ? 'The last analysis attempt failed.' : "This contract hasn't been analyzed yet."}
        </p>
        {processError && <p className="type-body-sm text-red-500">{processError}</p>}
        <button
          type="button"
          onClick={handleProcess}
          disabled={processing}
          className="type-body-lg rounded-md bg-blue-500 px-6 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400 disabled:hover:scale-100"
        >
          {processing ? 'Processing…' : contract.status === 'error' ? 'Retry Analysis' : 'Process Contract'}
        </button>
      </main>
    )
  }

  if (contract.status === 'processing') {
    return (
      <main className="flex h-full min-h-full items-center justify-center bg-grey-25 font-sans">
        <p className="type-body-lg text-grey-500">Analyzing this contract…</p>
      </main>
    )
  }

  const viewerProps = {
    contractId: contract.id,
    filePath: contract.file_path,
    contractText: contract.contract_text ?? '',
    targetPage,
    targetSourceSentence,
    onNavigated: () => {
      setTargetPage(null)
      setTargetSourceSentence(null)
    },
  }

  return (
    <main className="flex h-full flex-col bg-grey-25 font-sans">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-grey-100 bg-white px-4 py-3">
        <div>
          <h1 className="type-body-lg text-grey-900">{contract.name}</h1>
          <span className="type-body-sm text-grey-500">{contract.contract_type}</span>
        </div>
        <FeedbackWidget contractId={contract.id} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="h-[60vh] border-b border-grey-100 bg-white lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
          {contract.file_path && !pdfFailed ? (
            <PdfViewer {...viewerProps} onLoadFailure={() => setPdfFailed(true)} />
          ) : (
            <TextViewerFallback {...viewerProps} />
          )}
        </div>
        <div className="h-[40vh] bg-white lg:h-full lg:w-1/2">
          <KeyTermsPanel contractId={contract.id} onTermPageClick={handleTermPageClick} />
        </div>
      </div>

      <ChatPanel contractId={contract.id} onCitationClick={handleCitationClick} />
    </main>
  )
}
