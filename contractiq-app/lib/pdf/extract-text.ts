import type PdfParse from 'pdf-parse'

// Import the parser directly, bypassing pdf-parse's package `index.js` — its
// top-level `isDebugMode = !module.parent` self-test misfires under webpack
// (module.parent isn't set the way it is under native Node `require`) and
// throws trying to read a hardcoded test fixture path, crashing the module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as typeof PdfParse

interface ExtractedContract {
  text: string
  pageCount: number
}

interface PdfTextItem {
  str: string
}

// pdf-parse's default pagerender concatenates pages with no page boundaries.
// Overriding it lets us inject a `[PAGE N]` marker per page, which the
// results viewer and extraction pipeline both rely on for page attribution.
function renderPageWithMarker(pageData: { pageNumber: number; getTextContent: () => Promise<{ items: PdfTextItem[] }> }) {
  return pageData.getTextContent().then((textContent) => {
    const pageText = textContent.items.map((item) => item.str).join(' ')
    return `[PAGE ${pageData.pageNumber}]\n${pageText}`
  })
}

export async function extractText(buffer: Buffer): Promise<ExtractedContract> {
  const data = await pdfParse(buffer, { pagerender: renderPageWithMarker })

  return {
    text: data.text.trim(),
    pageCount: data.numpages,
  }
}
