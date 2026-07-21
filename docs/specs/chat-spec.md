# Spec: Contract Chat

**Feature area:** Document-grounded Q&A, persistent chat history, page citations
**Engineering doc references:** §4 Flow 4, §8, §10 Phase 4, FR-08, FR-09, US-007, US-012
**Depends on:** `upload-pipeline-spec.md` (`contracts.contract_text`), `supabase-schema.sql` (`chat_sessions`, `chat_messages`)

---

## 1. Overview

Full-context RAG-style chat: every turn passes the entire `contract_text` plus the full ascending message history to Claude. No chunking/vector retrieval at MVP (contracts are ≤15,000 tokens). Two API routes handle session bootstrap + message exchange; both are custom Next.js routes (not direct Supabase calls) because the POST route must call Claude.

## 2. Model Configuration

| Setting | Value |
|---|---|
| Model | Claude Sonnet |
| `temperature` | `0.4` |
| `max_tokens` | `1000` |
| System prompt | *"Answer only from the document text provided. If the answer is not in the document, say so — respond exactly 'I cannot find this in the document.' Prefix every substantive answer with 'Based on the document, ...'. Every answer that draws from the contract must end with a citation in the exact format `[Page X]` where X is the page number the information came from."* |

### Query classification (no extra API call, per engineering-doc §8)

A lightweight regex-based heuristic run in `lib/claude/chat-prompt.ts` before building the prompt, classifying each incoming message as `'contract' | 'history' | 'both'`:

```ts
const HISTORY_PATTERN = /\b(earlier|before|previously|you (said|mentioned|told)|what did (i|you) (ask|say))\b/i;

function classifyQuery(message: string): 'contract' | 'history' | 'both' {
  if (HISTORY_PATTERN.test(message)) {
    return /\b(clause|section|term|contract|agreement|page)\b/i.test(message) ? 'both' : 'history';
  }
  return 'contract';
}
```

- `'contract'` (default): system prompt emphasizes the document-only instruction as-is
- `'history'` / `'both'`: system prompt gets an additional line — *"The user may be referring to earlier turns in this conversation. Use the conversation history to answer, but still ground any contract-related claims in the document text and cite the page."*

This classification only changes prompt phrasing — the full contract text and full history are passed to Claude regardless of classification (per engineering-doc §8's "no chunking" full-context strategy); it does not gate what context is included.

### Citation validation

After receiving the response:
1. Check for the fallback phrase `"I cannot find this in the document"` (case-insensitive) — if present, treat as valid with `page_citation: null`
2. Else, regex-match `/\[Page\s+(\d+)\]/i`. If found, extract the number as `page_citation`
3. If neither is found: **one automatic retry** with an appended instruction — *"Your response must end with either a `[Page X]` citation or the exact fallback phrase 'I cannot find this in the document.' Regenerate your answer."*
4. If the retry also fails validation: store the response as-is with `page_citation: null` and prepend `"⚠️ "` to the stored `content` so the UI can render a visible caveat rather than silently presenting an uncited claim as fact (no-silent-failure principle)

---

## 3. Backend Implementation

### `GET /api/chat/[contractId]/messages`

**File:** `app/api/chat/[contractId]/messages/route.ts`

1. Auth + ownership check on the contract (`404`/`403` per the pattern in `extraction-pipeline-spec.md`)
2. `SELECT * FROM chat_sessions WHERE contract_id = ...` — if none exists, `INSERT INTO chat_sessions (contract_id, user_id)` and use the new row (lazy creation)
3. `SELECT * FROM chat_messages WHERE session_id = ... ORDER BY created_at ASC LIMIT 200`
4. Response `200`: `{ session_id, messages: [{ id, role, content, page_citation, created_at }] }`

### `POST /api/chat/[contractId]/messages`

**File:** same route file, `POST` handler.

**Request:** `{ message: string }`

**Processing:**
1. Auth + ownership check
2. Validate `message`: trimmed, non-empty, ≤ 2000 characters → else `400 { code: 'invalid_message' }`
3. Get-or-create `chat_sessions` row (same as GET)
4. Fetch `contract_text` from `contracts`; fetch existing `chat_messages` for the session (ascending, ≤200)
5. Classify the query (§2), build system + message array (history messages mapped to Claude's `role: 'user' | 'assistant'` format, contract text injected as part of the system prompt or an initial context block)
6. Call Claude; wrap in the same 3-attempt exponential-backoff retry as extraction (network/5xx errors only — citation-validation retry in §2 step 3 is separate and always exactly one attempt)
7. If all attempts fail: respond `502 { code: 'ai_provider_error', message: "We couldn't get a response right now. Try again in a few minutes." }` — **no message is persisted** on total failure, so the conversation isn't polluted with an error turn
8. On success: `INSERT INTO chat_messages (session_id, role: 'user', content: message)`, then `INSERT INTO chat_messages (session_id, role: 'assistant', content: response, page_citation)`
9. `UPDATE chat_sessions SET updated_at = now()`
10. Response `200`: `{ message: <assistant content>, page_citation: number | null, created_at: <timestamp> }`

### Error responses

| Status | Code | When |
|---|---|---|
| 401 | `unauthorized` | No session |
| 404 / 403 | `not_found` / `forbidden` | Contract ownership check |
| 400 | `invalid_message` | Empty or over-length message |
| 502 | `ai_provider_error` | Claude call failed after retries |

---

## 4. Frontend Implementation

### Files

| File | Purpose |
|---|---|
| `components/chat/ChatPanel.tsx` | Client Component. Tab or floating overlay on the Results page; owns the message list + input |
| `components/chat/ChatMessageList.tsx` | Renders messages, user right-aligned / assistant left-aligned, with the `[Page X]` citation rendered as a clickable link |
| `components/chat/ChatInput.tsx` | Text input + send button |

### Flow

1. On `ChatPanel` mount: `GET /api/chat/[contractId]/messages` to load existing history (US-012 — persistence across visits)
2. User types and submits → optimistically append the user message to local state immediately, show a "typing" indicator for the assistant turn
3. `POST /api/chat/[contractId]/messages { message }`
4. On success: replace the typing indicator with the real assistant message; if `page_citation` is present, render it as a clickable `[Page X]` tag that calls the same `onTermPageClick`-style navigation used by `KeyTermsPanel` (see `results-viewer-spec.md`), scrolling the active viewer to that page
5. On `502`: remove the typing indicator, show an inline error bubble "Couldn't get a response. Try again in a few minutes." with a retry button that resubmits the same `message` (the user's own message stays in the list either way — only the failed assistant turn is retried, and per §3 step 7 no error turn was ever persisted, so retry is clean)

### Latency budget

Per PRD constraint, chat responses must complete within **15 seconds P95**. The typing indicator has no artificial delay — it's shown for the actual duration of the `POST` call.

---

## 5. Data Model Touched

- `chat_sessions`: one row per contract, created lazily
- `chat_messages`: two rows per successful exchange (`user` then `assistant`); zero rows on total AI-provider failure

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| First message ever sent for a contract | `chat_sessions` row created lazily on first `GET` or `POST` — whichever happens first when the panel opens |
| User asks about something absent from the document | Model responds with the exact fallback phrase; UI renders it as a normal assistant message with no citation link (this is a **pass**, not an error, per engineering-doc §8) |
| Conversation exceeds 200 messages | Only the most recent 200 (ascending from the start — i.e., the cap is on total stored/fetched, not a sliding window) are ever fetched/passed as context; in practice this is far beyond normal usage for a single contract review session |
| User sends the same question twice in a row | No dedup — each is treated as an independent turn; the model may give a near-identical answer, which is expected behavior |
| Very long conversation pushes total context near the model's window | At ≤15,000 tokens for the document + up to 200 short messages, this stays well within Claude Sonnet's 200k-token window (engineering-doc §8) — no special handling needed at MVP |
| Assistant response missing citation even after the one retry | Stored with `page_citation: null` and a `"⚠️ "` prefix per §2 step 4 — surfaced to the user rather than silently presented as fully grounded |

---

## 7. Acceptance Criteria

- [ ] Reopening a contract's Results page loads its prior chat history in order (US-012)
- [ ] A new question about content present in the document gets a grounded answer with a `[Page X]` citation within 15 seconds P95 (US-007, FR-08)
- [ ] A question about content absent from the document gets the exact "I cannot find this in the document" response, not a fabricated answer
- [ ] Clicking a citation navigates the viewer to the cited page
- [ ] All chat messages are persisted to `chat_messages` with correct `role` and `created_at` in real time (FR-09)
- [ ] A Claude API failure never leaves an orphaned user message with no response and no error indicator — the user always sees either an answer or a retry-able error state
- [ ] Automated regression test: asking about a topic verified absent from a fixture contract returns the "cannot find this" fallback (engineering-doc §13 offline eval / PRD internal-risk mitigation)
