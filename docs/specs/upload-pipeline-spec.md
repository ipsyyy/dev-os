# Spec: PDF Upload & Text Extraction

**Feature area:** Contract upload, server-side text extraction, pre-processing preview
**Engineering doc references:** §4 Flow 3 (steps 1–2), §6, §10 Phase 2, FR-02, FR-03, FR-05, US-002, US-005
**Depends on:** `supabase-schema.sql` (`contracts`, `custom_key_terms`), `auth-spec.md` (session required)

---

## 1. Overview

A single API route accepts the PDF, validates it, extracts text server-side exactly once, stores the result, and returns a preview of what will be extracted. No AI call happens in this step — extraction (Claude) is triggered separately by `POST /api/contracts/[id]/process` (see `extraction-pipeline-spec.md`), which reads `contract_text` from the database and never re-touches the file.

## 2. Standard Term Preview Lists

Returned in the upload response so the frontend can render the pre-processing preview immediately, before any AI call:

- **NDA (10 terms):** Parties, Effective Date, Confidentiality Obligations, Permitted Disclosures, Term & Duration, Governing Law, Jurisdiction, IP Ownership, Non-Solicitation, Breach & Remedy
- **MSA (12 terms):** Parties, Service Scope, Payment Terms, Invoice Schedule, Late Payment Penalty, Liability Cap, Indemnification, IP Ownership, Termination Clause, Governing Law, Dispute Resolution, Notice Period

These lists are hardcoded in `lib/claude/extraction-prompt.ts` (shared with `extraction-pipeline-spec.md`) and imported into the upload route — not duplicated.

## 3. Frontend Implementation

### Files

| File | Purpose |
|---|---|
| `app/(dashboard)/contracts/new/page.tsx` | Upload screen: contract-type selector, dropzone, custom-term inputs, pre-processing preview, "Process Contract" CTA |
| `components/upload/UploadDropzone.tsx` | Client Component. Drag-and-drop + file-picker; client-side validation before submit |
| `components/upload/ContractTypeSelect.tsx` | Client Component. `'NDA' \| 'MSA'` dropdown |
| `components/upload/CustomTermInput.tsx` | Client Component. "+ Add Key Term" — up to 5 free-text inputs, each rendered with a "Custom" badge in the preview list |

### Client-side validation (before submit — server re-validates everything)

- File type: `application/pdf` (checked via `file.type` and `.pdf` extension)
- File size: ≤ 10 MB (`10 * 1024 * 1024` bytes)
- Contract type: must be selected (`'NDA'` or `'MSA'`) before the dropzone is enabled
- Custom terms: max 5 entries; each trimmed, non-empty, ≤ 100 characters

### Submit flow

1. User picks type + file (+ optional custom terms) → client validates → enables "Upload"
2. `POST /api/contracts/upload` as `multipart/form-data`
3. On `201`: render the pre-processing preview (standard terms for the selected type + any custom terms with a "Custom" badge) and enable "Process Contract", which calls `POST /api/contracts/[id]/process` (see `extraction-pipeline-spec.md`)
4. On error: show the specific message from the response body (see §6) — never a generic "something went wrong"

---

## 4. Backend Implementation — `POST /api/contracts/upload`

**File:** `app/api/contracts/upload/route.ts`

### Request

`multipart/form-data`:
- `file`: PDF binary, required
- `contract_type`: `'NDA' | 'MSA'`, required
- `custom_terms`: JSON-encoded `string[]`, optional, ≤ 5 entries

### Processing steps (in order)

1. **Auth check:** verify session via `lib/supabase/server.ts`; `401` if absent
2. **Server-side validation** (never trust client validation):
   - MIME type must be `application/pdf` → else `400 { code: 'invalid_file_type' }`
   - Size ≤ 10 MB → else `400 { code: 'file_too_large' }`
   - `contract_type` present and one of `'NDA' | 'MSA'` → else `400 { code: 'invalid_contract_type' }`
   - `custom_terms` (if present): valid JSON array, ≤ 5 entries, each a non-empty trimmed string ≤ 100 chars → else `400 { code: 'invalid_custom_terms' }`
   - Each custom term is compared case-insensitively against the standard term list for the selected `contract_type` (§2); an exact match → `400 { code: 'custom_term_duplicates_standard', message: '"<term>" is already part of the standard extraction.' }`
3. **Text extraction:** run `pdf-parse` (via `lib/pdf/extract-text.ts`) on the file buffer:
   - Get `numpages` and per-page text from `pdf-parse`'s page-render callback
   - Concatenate pages with a `[PAGE N]` marker (1-indexed) preceding each page's text, e.g. `[PAGE 1]\n...text...\n\n[PAGE 2]\n...`
   - **Scanned-PDF check:** if total extracted word count (`text.trim().split(/\s+/).filter(Boolean).length`) `< 100` → `422 { code: 'scanned_pdf_not_supported', message: 'Scanned PDFs are not supported yet.' }` — no DB row is created
   - **Page-count check:** if `numpages > 20` → `422 { code: 'too_many_pages', message: 'Contracts longer than 20 pages are not supported yet.' }`
   - **Token-limit check:** estimate tokens as `Math.ceil(extractedText.length / 4)` (character-based heuristic, ~4 chars/token for English prose — avoids a tokenizer dependency at MVP); if `> 15000` → `422 { code: 'token_limit_exceeded', message: 'This contract is too long for analysis (max ~15,000 tokens / 20 pages).' }`
4. **Storage upload (non-blocking):** upload the original PDF buffer to the `contracts` bucket at `contracts/{user_id}/{contract_id}/{filename}.pdf` using a pre-generated `contract_id` (uuid generated in the route, not by the DB default, so the path can be built before the insert). If this call throws or rejects, catch it, log a warning, and continue with `file_path = null` — **do not fail the request**.
5. **DB writes** (single transaction where the client library supports it; otherwise sequential with the `contracts` insert first since `custom_key_terms` FKs to it):
   - `INSERT INTO contracts (id, user_id, name, contract_type, file_path, contract_text, page_count, status) VALUES (<generated id>, auth.uid(), <original filename>, <contract_type>, <path or null>, <extracted text>, <numpages>, 'uploaded')`
   - For each custom term: `INSERT INTO custom_key_terms (contract_id, term_name) VALUES (...)`
6. **Response `201`:**
   ```json
   {
     "contract_id": "uuid",
     "status": "uploaded",
     "standard_terms_preview": ["Parties", "Effective Date", "..."],
     "custom_terms": ["Non-compete radius"]
   }
   ```

### Error responses

| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | No session |
| 400 | `invalid_file_type` / `file_too_large` / `invalid_contract_type` / `invalid_custom_terms` / `custom_term_duplicates_standard` | Malformed request |
| 422 | `scanned_pdf_not_supported` / `too_many_pages` / `token_limit_exceeded` | Valid request, but the document fails a content constraint |
| 500 | `upload_failed` | Unexpected error during parsing (e.g. corrupted PDF that passes the MIME check but `pdf-parse` throws) — no partial `contracts` row is left behind (the insert only happens after extraction succeeds) |

---

## 5. Data Model Touched

- `contracts`: one row inserted per successful upload (see `supabase-schema.sql`)
- `custom_key_terms`: 0–5 rows inserted, FK to the new `contracts.id`

No `key_terms` rows are written here — that happens only in `extraction-pipeline-spec.md`.

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| Corrupted PDF (valid MIME type, `pdf-parse` throws) | `500 upload_failed`; no DB row created; user sees "We couldn't read this PDF — try re-exporting it and uploading again." |
| PDF with 0 pages / empty file | Word count check catches this (`0 < 100`) → `422 scanned_pdf_not_supported` |
| Exactly 20 pages | Allowed (`> 20` is the reject condition, not `>= 20`) |
| Exactly 15,000 estimated tokens | Allowed (`> 15000` is the reject condition) |
| Storage upload fails (bucket unreachable, quota, etc.) | Non-blocking per §4 step 4 — `file_path` stays `null`, upload still succeeds, text-viewer fallback will be used later (see `results-viewer-spec.md`) |
| User uploads the same file twice | No dedup check at MVP — creates a second independent `contracts` row (each contract review is independent by design) |
| `custom_terms` contains duplicate entries among themselves (e.g. "Non-compete" twice) | Deduplicated case-insensitively server-side before insert; only unique entries count toward the 5-term cap |
| Filename contains characters unsafe for a Storage path | Filename used only for the `contracts.name` display column; the Storage object path uses the generated `contract_id`, not the raw filename, so no sanitization is needed for the path itself |

---

## 7. Acceptance Criteria

- [ ] Uploading a valid ≤10MB, ≤20-page, text-layer PDF with a selected contract type returns `201` with a `contract_id` and the correct standard-term preview list for that type (US-002)
- [ ] A file over 10MB is rejected client-side before any network call, and server-side with `400 file_too_large` if the client check is bypassed
- [ ] A PDF whose extracted text is under 100 words is rejected with the scanned-PDF message and no DB row is created (per Agent Capabilities table, engineering-doc §-adjacent PRD Component B)
- [ ] `contract_text` in the DB contains `[PAGE N]` markers for every page, 1-indexed
- [ ] Up to 5 custom terms can be added and appear in the response's `custom_terms` array with the same shape as standard terms will later have (US-005)
- [ ] A 6th custom term is rejected client-side (input disabled) and server-side (`400 invalid_custom_terms`) if bypassed
- [ ] If Supabase Storage is unreachable, the upload still succeeds and `file_path` is `null`
