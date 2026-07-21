export interface ContractViewerProps {
  contractId: string
  filePath: string | null
  contractText: string
  targetPage: number | null
  // Not in results-viewer-spec.md's literal ContractViewerProps listing, but
  // required to implement the highlight behavior spec'd in §3/§4/§6 — the
  // spec's own §6 says the parent "passes down" the active term's
  // source_sentence to the viewer, which needs a prop to carry it.
  targetSourceSentence: string | null
  onNavigated?: () => void
  // PdfViewer-only: signals the parent to swap permanently to TextViewerFallback
  // per §3/§7 ("falls back ... for the rest of the session"). TextViewerFallback
  // never calls it — kept on the shared type so both viewers take identical props.
  onLoadFailure?: () => void
}
