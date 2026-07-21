# Spec: Key Terms Panel & Inline Correction

**Feature area:** Key-term display, confidence badges, source-sentence explainability, inline editing
**Engineering doc references:** §5, §9 (direct-Supabase ops), §10 Phase 2–4, FR-04, FR-11, US-003, US-004, US-009
**Depends on:** `extraction-pipeline-spec.md` (`key_terms` rows must exist), `results-viewer-spec.md` (page-click navigation target)

---

## 1. Overview

The right-hand panel of the Results page. Renders every `key_terms` row for the contract. All reads and the inline-edit write are **direct Supabase client calls** (RLS-protected) — no custom API route, per engineering-doc §9.

## 2. Component Contract

```ts
interface KeyTerm {
  id: string;
  term_name: string;
  ai_value: string;
  current_value: string;
  page_number: number;
  confidence_score: number;   // 0–100
  source_sentence: string;
  is_custom: boolean;
  is_edited: boolean;
  edited_at: string | null;
}

interface KeyTermsPanelProps {
  contractId: string;
  onTermPageClick: (term: KeyTerm) => void; // sets targetPage + highlight sentence on the viewer
}
```

## 3. Data Fetching

- On mount: `supabase.from('key_terms').select('*').eq('contract_id', contractId).order('is_custom', { ascending: true }).order('created_at')` — standard terms first (insertion order from the extraction response, which follows the target-list order), custom terms appended after, each group in extraction order
- RLS (`key_terms_select_own` policy) ensures only the owner's rows are ever returned — no client-side ownership check needed

## 4. `KeyTermRow` (`components/results/KeyTermRow.tsx`)

Client Component. One row per term.

### Layout
`Term Name | Extracted Value | Page N (clickable) | Confidence Badge`, with an expandable "Why?" section below.

### Confidence badge (colour-coding, per FR-04 / engineering-doc §2)

| Range | Colour | Icon |
|---|---|---|
| `>= 80` | Green | none |
| `50–79.99` | Amber | none |
| `< 50` | Red | ⚠️, **non-dismissible tooltip**: "Low confidence — we recommend verifying this in the document directly." |

Colour is always paired with the numeric percentage and (for red) the icon+tooltip text — never colour alone (WCAG 2.1 AA, engineering-doc §5 Accessibility).

### "Why?" expander

Collapsed by default. Expanding reveals the verbatim `source_sentence` in a quoted block. Purely local UI state (`useState`), no network call — the sentence is already loaded with the row.

### Page click

Clicking the page number calls `props.onTermPageClick(term)`, which the parent Results page wires to the active viewer's `targetPage`/highlight props (see `results-viewer-spec.md` §6).

### Low-confidence auto-highlight

When a red-badge term's tooltip is opened (on focus/hover, since it's non-dismissible rather than click-triggered), also fire `onTermPageClick(term)` so the viewer auto-navigates — per the PRD hallucination-guardrail requirement that low-confidence terms auto-highlight their nearest matching span.

### "Edited" badge

Rendered next to the term name when `is_edited === true`. Hovering/tapping it can optionally reveal the original `ai_value` for comparison (not required for MVP, but the data is already on the row).

---

## 5. Inline Correction

### Trigger
Clicking the "Extracted Value" cell switches it to an inline text input, pre-filled with `current_value`.

### Save flow (direct Supabase write — no API route)

```ts
const { error } = await supabase
  .from('key_terms')
  .update({
    current_value: newValue,
    is_edited: true,
    edited_at: new Date().toISOString(),
  })
  .eq('id', term.id);
```

- RLS policy `key_terms_update_own` (scoped via the `contracts` ownership join) enforces the user can only edit their own terms — no app-level ownership check needed beyond that policy
- `ai_value` is **never** touched by this write — it stays the original extraction forever, feeding the correction-rate feedback loop (`term_corrections` view in `supabase-schema.sql`)
- On save: optimistically update local state immediately (perceived instant save), then confirm against the Supabase response; on error, revert the local value and show an inline "Couldn't save — try again" message next to the row

### Performance constraint

Per PRD §5 constraint, the save must complete within **2 seconds**. A single-row `UPDATE` against an indexed `id` PK is well within this budget; no additional optimization needed.

### Validation

- `newValue` trimmed; empty string is rejected client-side (revert to previous value, no save attempted) — a term's value should never be blanked out, only corrected
- No length cap beyond a sane UI textarea max (e.g. 2000 characters) to prevent pathological input

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| User edits a term, then immediately edits it again before the first save resolves | Debounce/disable the input while a save is in flight; second edit queues until the first completes |
| Network drops mid-save | Supabase call rejects → revert to the pre-edit value, show inline error, leave the input open so the user can retry without retyping |
| User clears the field entirely and blurs | Client-side validation blocks the save (§5) — reverts to `current_value`, no empty-string ever reaches the DB |
| Term has `value: "Not found in document"` (model found nothing) | Displayed like any other term, red confidence badge (`confidence_score: 0`), editable like any other — user can fill in the correct value manually if they know it |
| Two terms have identical `term_name` (shouldn't happen given the schema, but a custom term could coincidentally match a standard one after model normalization) | Rendered as separate rows since they're separate `key_terms` rows by `id` — no merge logic; extraction-pipeline-spec's duplicate-name rejection at upload time (`custom_term_duplicates_standard`) prevents the common case |

---

## 7. Acceptance Criteria

- [ ] Every `key_terms` row for the contract renders with name, value, page number, and confidence score (FR-04)
- [ ] Confidence badges are colour-coded correctly at the 80/50 thresholds, with the red tier always showing the ⚠️ icon and non-dismissible tooltip (FR-11)
- [ ] No term is ever hidden regardless of confidence score, including 0-confidence "not found" terms (FR-11)
- [ ] Expanding "Why?" shows the exact `source_sentence` text (US-003 traceability)
- [ ] Clicking a page number navigates the active viewer to that page (US-003)
- [ ] Editing a term's value saves to Supabase within 2 seconds and shows an "Edited" badge afterward, while `ai_value` remains unchanged in the DB (US-009)
- [ ] A failed save reverts the displayed value and surfaces an inline retry-able error, never a silent no-op
