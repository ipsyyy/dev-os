'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { createClient } from '@/lib/supabase/client'
import { findHighlightMatch } from '@/lib/results/highlight-match'
import type { ContractViewerProps } from './viewer-types'

// Served as a plain static file (copied by scripts/copy-pdf-worker.mjs on
// every install) rather than via `new URL(..., import.meta.url)` — that
// pattern routes the file through webpack's Terser pass in production
// builds, which can't parse `import.meta` inside pdfjs-dist's own
// pre-minified worker bundle.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const SIGNED_URL_TTL_SECONDS = 3600
const MIN_SCALE = 0.6
const MAX_SCALE = 2.4
const SCALE_STEP = 0.2

interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
}

interface CachedPageText {
  text: string
  items: Array<{ item: TextItem; start: number; end: number }>
}

export function PdfViewer({
  filePath,
  targetPage,
  targetSourceSentence,
  onNavigated,
  onLoadFailure,
}: ContractViewerProps) {
  const supabase = useMemo(() => createClient(), [])
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [scale, setScale] = useState(1.2)
  const [loadFailed, setLoadFailed] = useState(false)
  const [highlight, setHighlight] = useState<{ pageNumber: number; rects: HighlightRect[]; key: number } | null>(null)

  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageTextCache = useRef<Map<number, CachedPageText>>(new Map())

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!filePath) {
        setLoadFailed(true)
        onLoadFailure?.()
        return
      }

      const { data, error } = await supabase.storage.from('contracts').createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS)
      if (error || !data?.signedUrl) {
        console.warn('PdfViewer: signed URL request failed', error)
        if (!cancelled) {
          setLoadFailed(true)
          onLoadFailure?.()
        }
        return
      }

      try {
        const doc = await pdfjsLib.getDocument({ url: data.signedUrl }).promise
        if (cancelled) return
        setPdf(doc)
      } catch (err) {
        console.warn('PdfViewer: pdf.js failed to load the document', err)
        if (!cancelled) {
          setLoadFailed(true)
          onLoadFailure?.()
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  async function getPageText(page: PDFPageProxy): Promise<CachedPageText> {
    const cached = pageTextCache.current.get(page.pageNumber)
    if (cached) return cached

    const content = await page.getTextContent()
    let text = ''
    const items: CachedPageText['items'] = []
    for (const raw of content.items) {
      if (!('str' in raw)) continue
      const item = raw as TextItem
      const start = text.length
      text += item.str + ' '
      items.push({ item, start, end: start + item.str.length })
    }

    const result = { text, items }
    pageTextCache.current.set(page.pageNumber, result)
    return result
  }

  function rectFromItem(item: TextItem, viewport: PageViewport): HighlightRect {
    const x0 = item.transform[4]
    const y0 = item.transform[5]
    const x1 = x0 + item.width
    const y1 = y0 + item.height

    const [vx0, vy0] = viewport.convertToViewportPoint(x0, y0)
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1)

    return {
      left: Math.min(vx0, vx1),
      top: Math.min(vy0, vy1),
      width: Math.abs(vx1 - vx0),
      height: Math.abs(vy1 - vy0),
    }
  }

  useEffect(() => {
    if (!pdf || targetPage === null) return
    const doc = pdf
    const page = targetPage

    let cancelled = false

    async function navigate(pageNumber: number) {
      pageContainerRefs.current.get(pageNumber)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

      if (!targetSourceSentence) {
        setHighlight(null)
        onNavigated?.()
        return
      }

      try {
        const pdfPage = await doc.getPage(pageNumber)
        const { text, items } = await getPageText(pdfPage)
        const match = findHighlightMatch(text, targetSourceSentence)

        if (!match || cancelled) {
          setHighlight(null)
          onNavigated?.()
          return
        }

        const viewport = pdfPage.getViewport({ scale })
        const overlapping = items.filter((entry) => entry.end > match.startIndex && entry.start < match.endIndex)
        const rects = overlapping.map((entry) => rectFromItem(entry.item, viewport))

        if (!cancelled) {
          setHighlight(rects.length > 0 ? { pageNumber, rects, key: Date.now() } : null)
        }
      } catch (err) {
        console.warn('PdfViewer: highlight lookup failed, page navigation still succeeded', err)
        if (!cancelled) setHighlight(null)
      } finally {
        if (!cancelled) onNavigated?.()
      }
    }

    navigate(page)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, targetPage, targetSourceSentence, scale])

  if (loadFailed) return null

  if (!pdf) {
    return <div className="type-body-lg flex h-full items-center justify-center text-grey-500">Loading document…</div>
  }

  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-grey-100 bg-white px-4 py-2">
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
          className="type-body-sm rounded-md border border-grey-100 px-2 py-1 text-grey-700 hover:bg-grey-50"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="type-body-sm text-grey-500">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
          className="type-body-sm rounded-md border border-grey-100 px-2 py-1 text-grey-700 hover:bg-grey-50"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto bg-grey-50 p-4">
        {pageNumbers.map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            pdf={pdf}
            pageNumber={pageNumber}
            scale={scale}
            containerRef={(el) => {
              if (el) pageContainerRefs.current.set(pageNumber, el)
            }}
            highlightRects={highlight?.pageNumber === pageNumber ? highlight.rects : null}
            highlightKey={highlight?.pageNumber === pageNumber ? highlight.key : null}
          />
        ))}
      </div>
    </div>
  )
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  containerRef,
  highlightRects,
  highlightKey,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  containerRef: (el: HTMLDivElement | null) => void
  highlightRects: HighlightRect[] | null
  highlightKey: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Explicitly `| null` in the generic selects React's MutableRefObject
  // overload (writable .current) instead of the readonly RefObject one.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true)
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isVisible) return
    let cancelled = false

    async function render() {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      if (cancelled) return

      setSize({ width: viewport.width, height: viewport.height })

      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({ canvas, viewport }).promise
    }

    render()
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, scale, isVisible])

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el
        containerRef(el)
      }}
      className="relative bg-white shadow-sm"
      style={size ? { width: size.width, height: size.height } : { width: '100%', minHeight: 400 }}
    >
      <canvas ref={canvasRef} />
      {highlightRects?.map((rect, index) => (
        <div
          key={`${highlightKey}-${index}`}
          className="highlight-flash pointer-events-none absolute rounded-sm"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
      <span className="type-body-sm absolute bottom-1 right-2 text-grey-300">{pageNumber}</span>
    </div>
  )
}
