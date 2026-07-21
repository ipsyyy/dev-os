# Spec: Dashboard

**Feature area:** Contract history, summary stats, entry point to review flow
**Engineering doc references:** §4 Flow 2, §10 Phase 1 & 4, FR-10, US-008
**Depends on:** `auth-spec.md` (session required), `upload-pipeline-spec.md` / `extraction-pipeline-spec.md` (`contracts` rows)

---

## 1. Overview

`app/(dashboard)/dashboard/page.tsx`. All data is fetched via **direct Supabase client calls**, RLS-scoped to `auth.uid()` — no custom API route, per engineering-doc §9.

## 2. Data Fetching

Rendered as a Server Component where possible (per engineering-doc §5, RSC for read-only shells), using the server Supabase client (`lib/supabase/server.ts`):

```ts
const { data: contracts } = await supabase
  .from('contracts')
  .select('id, name, contract_type, status, created_at')
  .order('created_at', { ascending: false });
```

- Summary counts derived client-side from the fetched list (total count, count by `contract_type`) rather than a separate aggregate query — the list is already fetched and MVP scale doesn't warrant a second round trip
- No pagination at MVP (contract volume per user is low — 5–15/month per the PRD's primary persona); the full list is fetched and sorting/filtering happens client-side

## 3. Frontend Implementation

### Files

| File | Purpose |
|---|---|
| `app/(dashboard)/dashboard/page.tsx` | Server Component — fetches `contracts`, passes to child components |
| `components/dashboard/SummaryCard.tsx` | Total contracts, breakdown by NDA/MSA |
| `components/dashboard/ContractHistoryTable.tsx` | Client Component — sortable list (by date/name/type), each row clickable |

### Layout (per engineering-doc §4 Flow 2)

- Summary card at top: total contracts processed, NDA count, MSA count
- "Review a Contract" primary CTA button → `/contracts/new`
- Sortable history table below: columns Name, Type, Date, Status; sortable on Name/Type/Date via clickable column headers (client-side `Array.sort` on the already-fetched list, ascending/descending toggle)
- Clicking any row navigates to `/contracts/[id]`

### Status display in the table

| `contracts.status` | Row rendering |
|---|---|
| `uploaded` | Badge "Pending" — row still clickable, navigates to `/contracts/[id]` which shows the "Process Contract" CTA if results don't exist yet |
| `processing` | Badge "Processing…" |
| `completed` | Badge "Reviewed" (default green) |
| `error` | Badge "Failed" (red) — row click still navigates in, where the retry CTA from `extraction-pipeline-spec.md` is available |

### Empty state (US-008 / engineering-doc §4 Flow 1)

Zero contracts: replace the table with a centered message — "No contracts reviewed yet — upload your first contract to begin" — and the "Review a Contract" CTA prominent.

---

## 4. Data Model Touched

Read-only — `SELECT` against `contracts` only. No writes originate from the dashboard itself.

---

## 5. Edge Cases

| Case | Handling |
|---|---|
| User has contracts stuck in `status = 'processing'` (e.g. they navigated away mid-processing) | Displayed as-is with the "Processing…" badge; clicking in shows the same progress UI, which re-awaits or re-triggers as appropriate per `extraction-pipeline-spec.md`'s status guard (a genuinely stuck row past a reasonable time is a monitoring/ops concern, not a dashboard-level fix at MVP) |
| Very long contract name (original filename) | Truncated with `text-overflow: ellipsis` in the table cell; full name available via title/hover |
| Sorting by "Date" | Default sort on initial load (newest first); toggling re-sorts the already-fetched array, no re-fetch |

---

## 6. Acceptance Criteria

- [ ] Dashboard shows total contracts and NDA/MSA breakdown accurately (FR-10)
- [ ] History list is sortable by date, name, and type (FR-10)
- [ ] Clicking any row opens that contract's Results page (FR-10, US-008)
- [ ] Zero-contract state shows the empty-state message and CTA, not an empty table
- [ ] A user only ever sees their own contracts (enforced by RLS — verified via the cross-user RLS test in engineering-doc §13 Testing Strategy)
