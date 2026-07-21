'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { findHighlightMatch } from '@/lib/results/highlight-match'
import type { ContractViewerProps } from './viewer-types'

interface PageSection {
  pageNumber: number
  text: string
}

interface Flash {
  pageNumber: number
  startIndex: number
  endIndex: number
  key: number
}

const PAGE_MARKER_PATTERN = /\[PAGE (\d+)\]/g

function parsePages(contractText: string): PageSection[] {
  const markers = Array.from(contractText.matchAll(PAGE_MARKER_PATTERN))
  if (markers.length === 0) {
    return contractText.trim() ? [{ pageNumber: 1, text: contractText.trim() }] : []
  }

  return markers.map((marker, index) => {
    const start = marker.index! + marker[0].length
    const end = index + 1 < markers.length ? markers[index + 1].index! : contractText.length
    return { pageNumber: Number(marker[1]), text: contractText.slice(start, end).trim() }
  })
}

export function TextViewerFallback({
  contractText,
  targetPage,
  targetSourceSentence,
  onNavigated,
}: ContractViewerProps) {
  const pages = useMemo(() => parsePages(contractText), [contractText])
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [flash, setFlash] = useState<Flash | null>(null)

  useEffect(() => {
    if (targetPage === null) return

    pageRefs.current.get(targetPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    const page = pages.find((p) => p.pageNumber === targetPage)
    const match = page && targetSourceSentence ? findHighlightMatch(page.text, targetSourceSentence) : null

    setFlash(match ? { pageNumber: targetPage, ...match, key: Date.now() } : null)
    onNavigated?.()
    // Re-running only on navigation intent (targetPage/sentence), not on `pages`
    // or the onNavigated identity, matches the viewer's "respond to prop change" contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPage, targetSourceSentence])

  if (pages.length === 0) {
    return <div className="type-body-lg p-6 text-grey-500">No contract text available.</div>
  }

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto p-6">
      {pages.map((page) => (
        <div
          key={page.pageNumber}
          ref={(el) => {
            if (el) pageRefs.current.set(page.pageNumber, el)
          }}
          className="flex flex-col gap-2"
        >
          <h3 className="type-h5 text-grey-900">Page {page.pageNumber}</h3>
          <pre className="whitespace-pre-wrap break-words font-mono text-[14px] leading-6 text-grey-900">
            {flash && flash.pageNumber === page.pageNumber ? (
              <>
                {page.text.slice(0, flash.startIndex)}
                <span key={flash.key} className="highlight-flash rounded-sm">
                  {page.text.slice(flash.startIndex, flash.endIndex)}
                </span>
                {page.text.slice(flash.endIndex)}
              </>
            ) : (
              page.text
            )}
          </pre>
        </div>
      ))}
    </div>
  )
}
