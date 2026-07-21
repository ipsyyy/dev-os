# Spec: Key Term Extraction (Claude)

**Feature area:** AI-driven key-term extraction, standard + custom terms, confidence scoring, source attribution
**Engineering doc references:** §8 (AI Architecture), §10 Phase 2–3, FR-04, FR-05, FR-11, US-002, US-003, US-004, US-005
**Depends on:** `upload-pipeline-spec.md` (`contracts.contract_text` must already exist), `supabase-schema.sql` (`key_terms`, `custom_key_terms`)

---

## 1. Overview

`POST /api/contracts/[id]/process` reads the already-extracted `contract_text` (never the file), builds a schema-constrained prompt, and calls Claude with **forced tool-use** so the response is guaranteed to be parseable structured data. One call handles both standard and custom terms in a single pass.

## 2. Model Configuration

| Setting | Value |
|---|---|
| Provider | Anthropic Claude (`@anthropic-ai/sdk`) |
| Model | Claude Sonnet (`ANTHROPIC_API_KEY` from env) |
| `temperature` | `0.1` |
| `max_tokens` | `2000` |
| `tool_choice` | `{ type: "tool", name: "extract_key_terms" }` — forces the model to respond via the tool call, never free text |

### Tool definition (`lib/claude/extraction-prompt.ts`)

```ts
const extractKeyTermsTool = {
  name: "extract_key_terms",
  description: "Extract key contractual terms from the provided contract text.",
  input_schema: {
    type: "object",
    properties: {
      terms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term_name: { type: "string" },
            value: { type: "string" },
            page_number: { type: "integer", minimum: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 100 },
            source_sentence: { type: "string" },
          },
          required: ["term_name", "value", "page_number", "confidence_score", "source_sentence"],
        },
      },
    },
    required: ["terms"],
  },
}
```

### System prompt structure

1. Role framing: "You are a contract analysis assistant extracting specific terms from a [NDA|MSA]."
2. Instruction: "For each term in the target list below, find its value in the contract text. Use the `[PAGE N]` markers in the text to determine `page_number`. Quote the exact sentence you drew the value from as `source_sentence`. Self-report a `confidence_score` (0–100) reflecting how certain you are the extracted value is correct and complete. If a term is genuinely absent from the document, still return it with `value: \"Not found in document\"` and `confidence_score: 0` — do not omit it."
3. Target term list: the standard list for the contract's `contract_type` (see `upload-pipeline-spec.md` §2) **plus** any rows from `custom_key_terms` for this contract
4. Few-shot examples: 3 labelled NDA examples + 3 labelled MSA examples embedded in the system prompt (only the examples matching the current `contract_type` are included, to save tokens) — each example shows a short contract excerpt and its correct `extract_key_terms` tool call
5. The full `contract_text` (with `[PAGE N]` markers) as the user message

---

## 3. Backend Implementation — `POST /api/contracts/[id]/process`

**File:** `app/api/contracts/[id]/process/route.ts`

### Request

No body. `id` is the contract UUID from the path.

### Processing steps

1. **Auth + ownership:** verify session; `404` if no contract with that `id` exists at all (don't leak existence to non-owners); `403` if it exists but `contracts.user_id !== session.user.id`
2. **Status guard:** if `contracts.status === 'processing'` → `409 { code: 'already_processing' }`. If `contracts.status === 'completed'` → `409 { code: 'already_completed' }` (re-processing isn't supported at MVP — the user would need to re-upload for a fresh review)
3. **Set status:** `UPDATE contracts SET status = 'processing'`
4. **Fetch context:** `contract_text`, `contract_type` from `contracts`; all `term_name` rows from `custom_key_terms WHERE contract_id = id`
5. **Build prompt** per §2, call Claude with forced tool-use
6. **Retry logic:** wrap the Claude call in up to **3 attempts** with exponential backoff (1s, 2s, 4s) on:
   - Network/5xx errors from the Anthropic API
   - Tool-call parsing failure (response doesn't include a valid `extract_key_terms` call matching the schema) — on this specific failure type, the retry prompt appends: *"Your previous response was not valid. Call the `extract_key_terms` tool with all required fields for every term."*
   - If all 3 attempts fail: `UPDATE contracts SET status = 'error', error_message = <human-readable summary>`; respond `502 { code: 'ai_provider_error', message: 'We couldn't analyze this contract right now. Try again in a few minutes.' }`
7. **Validate the parsed response:** every returned term must have all 5 fields, `confidence_score` in `[0, 100]`, `page_number >= 1` and `<= contracts.page_count`. Any term failing this validation is dropped and logged (not inserted) rather than failing the whole request — partial-but-valid results are better than none, and standard terms not returned by the model are simply absent from the panel (the UI does not need every term to be present).
8. **Tag custom vs. standard:** for each validated term, set `is_custom = true` if its `term_name` case-insensitively matches an entry in `custom_key_terms` for this contract, else `false`
9. **Write results:** `INSERT INTO key_terms (contract_id, term_name, ai_value, current_value, page_number, confidence_score, source_sentence, is_custom) VALUES (...)` — one row per validated term; `current_value` initialized equal to `ai_value`
10. **Finalize:** `UPDATE contracts SET status = 'completed'`
11. **Response `200`:**
    ```json
    {
      "contract_id": "uuid",
      "status": "completed",
      "key_terms": [
        {
          "id": "uuid",
          "term_name": "Governing Law",
          "value": "State of Delaware",
          "page_number": 4,
          "confidence_score": 92.5,
          "source_sentence": "This Agreement shall be governed by the laws of the State of Delaware.",
          "is_custom": false,
          "is_edited": false
        }
      ]
    }
    ```

### Error responses

| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | No session |
| 404 | `not_found` | Contract doesn't exist |
| 403 | `forbidden` | Contract belongs to another user |
| 409 | `already_processing` / `already_completed` | Status guard |
| 413 | `token_limit_exceeded` | Defensive re-check — should already be caught at upload, but re-validated here in case `contract_text` was somehow mutated |
| 502 | `ai_provider_error` | All 3 Claude attempts failed |

---

## 4. Frontend Implementation

Triggered from `app/(dashboard)/contracts/new/page.tsx` (after upload succeeds) via the "Process Contract" button, and rendered on `app/(dashboard)/contracts/[id]/page.tsx` once complete.

- **Progress indicator:** 3-step UI (extracting text → analysing with AI → compiling results). Since extraction already happened at upload, the frontend shows step 1 as instantly complete, then polls or awaits the single `POST /process` call for steps 2–3 (no server-sent progress events at MVP — the whole call is awaited and the UI shows an indeterminate spinner for step 2–3 combined, budgeted at ≤30s P95 per the engineering doc's latency target)
- **On success:** navigate to `/contracts/[id]` (or re-render in place if already there), passing `key_terms` into `<KeyTermsPanel />` (see `key-terms-panel-spec.md`)
- **On `502`:** show a full-width error banner: "We couldn't analyze this contract right now. Try again in a few minutes." with a **Retry** button that re-calls `POST /process` (contract `status` is `'error'`, so the route allows a fresh attempt — no re-upload needed)
- **On `409 already_completed`:** should not normally be reachable from the UI (the button is hidden once results exist), but if hit, silently redirect to the results view instead of showing an error

---

## 5. Data Model Touched

- `contracts.status`, `contracts.error_message` — updated through the `uploaded → processing → completed|error` lifecycle
- `key_terms` — bulk insert, one row per successfully validated extracted term

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| Model returns a term not on the target list (hallucinated extra term) | Rejected at validation (step 7 is scoped to expected `term_name`s from the target list — any extra term names are dropped) |
| Model omits a standard term entirely | Accepted — the UI simply doesn't render a row for it; not treated as an error |
| Model returns `page_number` outside `[1, page_count]` | Term dropped per §3 step 7 validation (better to omit than mis-attribute) |
| Two custom terms with near-identical names (e.g. "Non-compete radius" vs "non compete radius ") | Matched case-insensitively with whitespace trimmed for the `is_custom` tag; both are still extracted independently since they're separate `custom_key_terms` rows |
| Contract genuinely lacks a clause (e.g. no non-solicitation clause in an NDA) | Model returns `value: "Not found in document"`, `confidence_score: 0` — rendered with the red low-confidence warning, not hidden (FR-11: never hide a term) |
| Claude API key missing/invalid | Surfaces as a `502` after the retry loop exhausts (auth errors are not distinguished from transient errors in the retry logic — both count as attempt failures) |
| Contract has exactly the boundary token count | Passed through; the 413 re-check here mirrors the upload-time check as defense-in-depth, not a new lower limit |

---

## 7. Acceptance Criteria

- [ ] Processing a valid NDA returns all 10 standard NDA terms (or fewer, if genuinely absent) plus any custom terms, each with `value`, `page_number`, `confidence_score`, `source_sentence` (FR-04, US-002)
- [ ] Processing a valid MSA returns the 12 standard MSA terms with the same structure
- [ ] Every returned term includes a non-empty `source_sentence` (US-003's "Why?" tooltip depends on this)
- [ ] Confidence scores are always in `[0, 100]` and every term is shown regardless of score — terms under 50 are never hidden (FR-11)
- [ ] Custom terms are extracted with `is_custom: true` and identical field structure to standard terms (US-005)
- [ ] A transient Claude API failure is retried up to 3 times with backoff before surfacing an error to the user (no silent failure)
- [ ] After 3 failed attempts, `contracts.status = 'error'` and the user can retry via the same route without re-uploading
- [ ] P95 end-to-end time for `POST /process` on a 20-page contract is ≤ 20 seconds (model call budget from engineering-doc §8)
