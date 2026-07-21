# Spec: Feedback Collection

**Feature area:** Thumbs up/down rating + optional comment per contract review
**Engineering doc references:** §10 Phase 5, FR-12, US-010 (P2 priority)
**Depends on:** `extraction-pipeline-spec.md` (feedback is submitted against a completed review), `supabase-schema.sql` (`user_feedback`)

---

## 1. Overview

A lightweight rating widget on the Results page. Direct Supabase client insert — no custom API route, per engineering-doc §9. P2 priority: build after all P0/P1 features are complete.

## 2. Frontend Implementation

### Files

| File | Purpose |
|---|---|
| `components/results/FeedbackWidget.tsx` | Client Component, rendered on `app/(dashboard)/contracts/[id]/page.tsx` once `contracts.status === 'completed'` |

### UI

- Two icon buttons: 👍 / 👎 (thumbs up/down), mutually exclusive selection
- On selecting either, reveal an optional text comment field (max 500 characters) and a "Submit" button
- After submission: replace the widget with "Thanks for your feedback!" (no further edits allowed per contract — one feedback submission per contract per user, matching the `user_feedback` schema's lack of an update path)

### Submit flow (direct Supabase write)

```ts
const { error } = await supabase.from('user_feedback').insert({
  user_id: session.user.id,
  contract_id: contractId,
  rating: selectedRating,      // 'up' | 'down'
  comment: comment.trim() || null,
});
```

- RLS policy `user_feedback_insert_own` (schema requires `user_id = auth.uid()`) enforces the caller can only insert feedback attributed to themselves
- On error: show an inline "Couldn't submit feedback — try again" message, keep the widget in its pre-submit state so the user can retry

---

## 3. Data Model Touched

- `user_feedback`: one row inserted per submission

---

## 4. Edge Cases

| Case | Handling |
|---|---|
| User has already submitted feedback for this contract (revisits the page) | On mount, check `supabase.from('user_feedback').select('id').eq('contract_id', contractId).eq('user_id', session.user.id).maybeSingle()`; if a row exists, render the "Thanks for your feedback!" state directly instead of the input widget |
| User selects a rating but submits no comment | Allowed — `comment` is nullable; rating alone is a complete, valid submission |
| Comment exceeds 500 characters | Client-side character counter blocks further input past the limit; no server-side truncation needed since the input can't produce an over-limit value |
| Contract status is not yet `'completed'` | Widget is not rendered at all — feedback only makes sense once results exist |

---

## 5. Acceptance Criteria

- [ ] A completed contract's Results page shows the thumbs-up/down widget (FR-12, US-010)
- [ ] Selecting a rating and optionally adding a comment saves to `user_feedback` with the correct `user_id`, `contract_id`, `rating`, and `comment`
- [ ] Revisiting a contract already rated shows the "Thanks for your feedback!" state instead of allowing a duplicate submission
- [ ] A failed save is retry-able and never silently discarded
