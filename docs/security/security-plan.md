# Security Audit — ContractIQ

**Date:** 2026-07-20
**Scope:** Targeted audit requested directly by the user, not the generic checklist in `skills/security-foundation/SKILL.md` (see note below).

---

## Note on `skills/security-foundation/SKILL.md`

That skill file does not match this project — it appears to be unedited boilerplate from a different reference app. Specifics that conflict with ContractIQ's actual, already-approved architecture:

- Redirects unauthenticated users to `/login`; ContractIQ's real route is `/sign-in`
- Requires server-side `app/api/auth/login` / `logout` routes; `auth-spec.md` (approved) explicitly chose client-side sign-in/sign-out via the Supabase SDK, with no `/api/auth/*` routes
- References `OPENAI_API_KEY`; ContractIQ uses `ANTHROPIC_API_KEY` (Stage 1 decision)
- Allows `.docx` uploads and 200-page / 5000-character limits; `upload-pipeline-spec.md` and `chat-spec.md` (both approved and implemented) specify PDF-only, 20-page, and 2000-character caps respectively
- Its own completion message points to "Stage 4 — Frontend Setup" next, which was already completed early in this project

None of that skill's specifics were applied. This audit instead covers exactly what the user asked for.

---

## Findings

| # | Area | Result | Action |
|---|---|---|---|
| 1 | Hardcoded secrets in source | None found (grepped for key patterns, JWT-shaped strings, `sk-ant-` prefixes across `app/`, `lib/`, `components/`) | None needed |
| 2 | Secrets in `console.log`/`warn`/`error` | 4 call sites found, all log descriptive `Error` objects (signed-URL failures, PDF.js load failures) — no credentials, tokens, or session data in any of them | None needed |
| 3 | Secrets exposed via `NEXT_PUBLIC_` | `SUPABASE_SERVICE_ROLE_KEY` is never referenced in application code at all (only used server-side in ad-hoc admin scripts outside the app). `ANTHROPIC_API_KEY` is referenced exactly once, in `lib/claude/client.ts`, imported only by server-side route handlers — confirmed absent from every `'use client'` file | None needed |
| 4 | API routes missing auth checks | All 3 route handlers (`upload`, `[id]/process`, `chat/[contractId]/messages`) call `supabase.auth.getUser()` and return `401` before any other logic; `middleware.ts` provides a second layer (`/dashboard`, `/contracts`, `/api` all gated). `app/auth/callback/route.ts` is intentionally unauthenticated — it's the session-creation entry point itself | None needed |
| 5 | Stack traces / raw errors in responses | Every `catch` block across all 3 routes returns a curated string via a shared `errorResponse()` helper; no `.stack`, no raw `err.message`, no Supabase error objects ever reach a response body | None needed |
| 6 | Missing security headers | `next.config.mjs` had no `headers()` config at all — no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, or HSTS | **Fixed** — see below |
| 7 | Unsafe `eval`/`innerHTML` | No `dangerouslySetInnerHTML`, `.innerHTML =`, `eval(`, or `new Function(` anywhere in the codebase | None needed |
| 8 | `.gitignore` coverage for env files | **No `.gitignore` existed anywhere in the repo.** `contractiq-app/.env.local` (real Supabase service-role key + Anthropic API key) was untracked but completely unprotected — a plain `git add -A` would have staged it. 13,628 of ~13,737 untracked files were `node_modules/`. | **Fixed** — see below |

---

## Fixes Applied

### `.gitignore` (new, repo root)
Added `node_modules/`, `.next/`, `.env`, `.env.local`, `.env.*.local`, and standard OS/editor/log noise. `.env.example` is deliberately **not** ignored — it's a template with no real values and is meant to be committed. Verified with `git check-ignore` that `.env.local`, `node_modules/`, and `.next/` are now correctly excluded, and that `.env.example` is not.

### `next.config.mjs` (edited)
Added a `headers()` function applying to all routes:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` — scoped to what this app actually needs: `'unsafe-inline'`/`'unsafe-eval'` on `script-src` (required by Next.js App Router's own hydration scripts and dev-mode HMR), `connect-src` allowing `*.supabase.co` and `api.anthropic.com`, `worker-src blob:` for the PDF.js worker, `img-src`/`font-src` covering `data:`/`blob:` for canvas rendering and the self-hosted Inter font.

Verified via `curl -D -` that all six headers are present on responses, and re-ran the golden-path smoke test (dashboard, contracts/new, sign-in — all `200`) to confirm the config change itself didn't break routing.

**Not verified:** whether the CSP is *correctly scoped* — that requires a real browser, since CSP violations only surface as browser console errors, not HTTP status codes. The two things most likely to break if the policy is too strict are PDF.js worker loading and Next.js hydration; both were explicitly allowed for, but this needs a visual click-through to confirm before relying on it in production.

---

## Outstanding / Not Covered

- CSP correctness needs browser verification (see above)
- Rate limiting is not implemented (no endpoint currently enforces request-frequency limits)
- Prompt injection defenses are not implemented — contract text and chat messages are passed to Claude without adversarial-input screening
- No automated test suite exists yet (this audit was a manual/scripted pass, not a CI-integrated check)

These weren't part of what was asked for in this pass; flagging so they're not mistaken for "checked and clean."
