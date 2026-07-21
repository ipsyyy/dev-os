// Copies pdfjs-dist's worker build into public/ so PdfViewer.tsx can load it
// as a plain static asset (workerSrc = '/pdf.worker.min.mjs') instead of via
// `new URL(..., import.meta.url)` — that pattern routes the file through
// webpack's JS/Terser pipeline in production, and Terser can't parse
// `import.meta` inside pdfjs-dist's own pre-minified worker bundle.
// Runs on every `npm install` (see package.json "postinstall") so this copy
// can never drift from whatever pdfjs-dist version is actually installed.
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const dest = path.join(__dirname, '..', 'public', 'pdf.worker.min.mjs')

copyFileSync(src, dest)
console.log('Copied pdf.worker.min.mjs to public/')
