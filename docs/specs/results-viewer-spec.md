# Spec: Results Viewer (PDF Viewer + Text Fallback)

**Feature area:** Contract document display, page navigation from key-term clicks
**Engineering doc references:** §5, §10 Phase 3, FR-06, FR-07, US-006
**Depends on:** `upload-pipeline-spec.md` (`contracts.file_path`, `contracts.contract_text`)

---

## 1. Overview

The Results page (`app/(dashboard)/contracts/[id]/page.tsx`) always shows the contract content — either the interactive PDF.js viewer (when `file_path` is set and a signed URL can be issued) or a paginated text viewer that parses `[PAGE N]` markers from `contract_text` (always available, since `contract_text` is required for a contract to exist). Both viewers accept a `targetPage` prop and must respond identically to key-term click events (FR-06).

## 2. Component Contract

```ts
interface ContractViewerProps {
  contractId: string;
  filePath: string | null;      // null → force text-viewer fallback
  contractText: string;         // always present, used by the fallback and for highlight-span matching
  targetPage: number | null;    // set by KeyTermsPanel on click; null = no pending navigation
  onNavigated?: () => void;     // called after the viewer has scrolled, to let the parent clear targetPage
}
```

`app/(dashboard)/contracts/[id]/page.tsx` decides which component to render:

```
filePath !== null
  → attempt <PdfViewer />; if the signed-URL fetch or PDF.js load fails at runtime, fall back to <TextViewerFallback /> for the rest of the session
filePath === null
  → render <TextViewerFallback /> directly, no PDF.js attempt
```

---

## 3. `PdfViewer` (`components/results/PdfViewer.tsx`)

Client Component (`'use client'`).

- On mount, requests a signed URL: `supabase.storage.from('contracts').createSignedUrl(filePath, 3600)` (1-hour expiry, per engineering-doc §7 Storage)
- Renders the PDF via `pdfjs-dist`, lazily loading pages (only render pages within/near the viewport) to keep initial load light on large files
- Supports scroll, pinch/click-zoom
- When `targetPage` changes to a non-null value: smooth-scrolls to that page, then applies a temporary highlight (background flash, ~1.5s fade) on the paragraph nearest the term's `source_sentence` (matched via substring search within that page's text layer), then calls `onNavigated()`
- If the signed-URL request fails (expired session, Storage outage) or `pdfjs-dist` throws during load: catch the error, log it, and signal the parent to switch to `<TextViewerFallback />` for the remainder of the session (no repeated retry loop against a down service)

## 4. `TextViewerFallback` (`components/results/TextViewerFallback.tsx`)

Client Component.

- Parses `contractText` by splitting on the `[PAGE N]` marker pattern (`/\[PAGE (\d+)\]/g`) into an array of `{ pageNumber, text }` sections
- Renders each section as a labelled block: `Page {N}` heading followed by the page's plain text in a monospace-adjacent readable font
- When `targetPage` changes: smooth-scrolls the corresponding page section into view and applies the same highlight treatment as `PdfViewer`, matching on `source_sentence` substring within that page's text
- No zoom/pan needed (it's plain text) — supports standard browser text selection/copy

## 5. Highlight Matching (shared logic — `lib/results/highlight-match.ts`)

Both viewers need to locate a term's `source_sentence` within a page's content to highlight it:

- Normalize whitespace (collapse multiple spaces/newlines) on both the page text and the `source_sentence` before comparing
- Use a case-insensitive substring search; if an exact match isn't found (model paraphrased slightly), fall back to fuzzy matching on the first 40 characters of the sentence
- If no match is found at all (rare — model attribution imprecision), still scroll to the correct page (from `page_number`) but skip the highlight — page-level navigation must never fail even if span-level highlight does

---

## 6. Frontend Wiring

- `KeyTermsPanel` (see `key-terms-panel-spec.md`) holds `targetPage` and the active term's `source_sentence` in local state on the parent Results page; clicking a term's page number sets both and passes them down to the active viewer
- Low-confidence terms (`confidence_score < 50`) auto-trigger the same navigation+highlight behavior when their warning tooltip is opened (FR-11 / PRD hallucination-guardrail requirement: "The PDF viewer auto-highlights the nearest matching page span")

---

## 7. Edge Cases

| Case | Handling |
|---|---|
| `file_path` is set but the file was deleted from Storage out-of-band | Signed-URL creation fails → falls back to `TextViewerFallback` per §3 |
| Signed URL expires mid-session (user has the page open > 1 hour) | On the next `targetPage` navigation, if PDF.js reports a load failure, re-request a fresh signed URL once before falling back to the text viewer |
| `source_sentence` spans a page break in the original document | Highlight matches within the `page_number` the model reported; if the sentence was truncated across pages in `contract_text`, the substring match may fail silently — acceptable per §5 (page navigation still succeeds) |
| Very large PDF (near 10MB, many pages) causes slow PDF.js load | Lazy page rendering (§3) mitigates memory/render time; if `PdfViewer` doesn't finish its first paint within a reasonable client-side timeout, the parent may offer a manual "Switch to text view" link as an escape hatch |
| Mobile viewport | Two-panel layout collapses to tabs below 768px (per engineering-doc §5 UX States); PDF viewer retains pinch-zoom, text viewer scrolls normally |

---

## 8. Acceptance Criteria

- [ ] When `file_path` is present, `PdfViewer` renders the PDF with working scroll and zoom (US-006)
- [ ] When `file_path` is null, `TextViewerFallback` renders all pages labelled with their page numbers, parsed correctly from `[PAGE N]` markers
- [ ] Clicking a key term's page number scrolls the active viewer (PDF or text) to the correct page within a smooth-scroll animation (FR-07)
- [ ] The nearest matching paragraph/span is visually highlighted after navigation, fading after ~1.5s
- [ ] If `PdfViewer` fails to load at runtime, the page transparently falls back to `TextViewerFallback` without a broken/blank panel
- [ ] Both viewers respond identically to `targetPage` prop changes (same navigation contract, per FR-06)
