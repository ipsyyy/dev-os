# Spec: Authentication

**Feature area:** Sign up, sign in, sign out, session management, route protection
**Engineering doc references:** §4 Flow 1–2, §10 Phase 1, FR-01, US-001
**Depends on:** `supabase-schema.sql` (uses `auth.users`, managed by Supabase — no custom table)

---

## 1. Overview

Email/password authentication via Supabase Auth. No custom `users`/`profiles` table exists — every application table references `auth.users(id)` directly. Supabase Auth's email-confirmation flow is enabled, matching the PRD's Flow 1 ("Email Verification → Redirect to Dashboard").

**Supabase project configuration required (one-time, dashboard):**
- Authentication → Providers → Email: enabled, "Confirm email" turned **on**
- Authentication → URL Configuration → Redirect URLs: add `{NEXT_PUBLIC_SITE_URL}/auth/callback`

---

## 2. User Flows

### 2.1 Sign Up (engineering-doc §4 Flow 1)

```
User submits email + password on /sign-up
  → Frontend: supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${SITE_URL}/auth/callback` } })
  → Supabase Auth creates a row in auth.users (unconfirmed), sends a confirmation email
  → Frontend shows "Check your email to confirm your account" — no session yet
  → User clicks the emailed link → browser opens /auth/callback?code=...
  → Route handler exchanges the code for a session (supabase.auth.exchangeCodeForSession)
  → Redirect to /dashboard
```

### 2.2 Sign In

```
User submits email + password on /sign-in
  → Frontend: supabase.auth.signInWithPassword({ email, password })
  → On success: Supabase sets the session cookie, frontend redirects to /dashboard
  → On failure: inline error "Invalid email or password" (no distinction between
    "wrong password" and "no such user" — avoids user enumeration)
```

### 2.3 Sign Out

```
User clicks "Sign Out" (in dashboard header)
  → Frontend: supabase.auth.signOut()
  → Redirect to / (landing page)
```

---

## 3. Frontend Implementation

### Files

| File | Purpose |
|---|---|
| `app/(auth)/sign-up/page.tsx` | Client Component. Email + password form, calls `signUp`, shows the "check your email" state |
| `app/(auth)/sign-in/page.tsx` | Client Component. Email + password form, calls `signInWithPassword` |
| `app/auth/callback/route.ts` | Route Handler (server). Exchanges the confirmation code for a session, redirects to `/dashboard` |
| `lib/supabase/client.ts` | `createBrowserClient` from `@supabase/ssr`, used by all Client Components |
| `lib/supabase/server.ts` | `createServerClient` from `@supabase/ssr`, used by Server Components, Route Handlers, and API routes |
| `middleware.ts` | Session refresh + route protection (see §5) |

### Form validation (client-side, before calling Supabase)

- Email: standard email-format regex; required
- Password: minimum 8 characters (Supabase default minimum); required
- Confirm-password field on sign-up: must match `password`, checked client-side before submit

### UI states

| State | Behavior |
|---|---|
| Submitting | Submit button shows a spinner, disabled to prevent double-submit |
| Sign-up success | Replace the form with "Check your email to confirm your account" — do not redirect (no session exists yet) |
| Sign-in error | Inline red text under the form: "Invalid email or password" |
| Sign-up error (email already registered) | Supabase returns a generic error for existing unconfirmed emails (anti-enumeration); surface as "If this email isn't already registered, check your inbox for a confirmation link" |
| Auth flow timing | Per PRD constraint, the full round trip (submit → session established → redirect) must complete in ≤ 10s; both calls are single Supabase Auth requests, well within budget |

---

## 4. Backend Implementation

### `app/auth/callback/route.ts`

```
GET /auth/callback?code=<code>
  1. Read `code` from the query string. If missing, redirect to /sign-in?error=missing_code
  2. Call supabase.auth.exchangeCodeForSession(code) using the server Supabase client
  3. On success: redirect (302) to /dashboard
  4. On failure (expired/invalid code): redirect to /sign-in?error=invalid_or_expired_link
```

This is the only auth-related server code beyond middleware — sign-up/sign-in/sign-out itself is handled client-side via the Supabase JS SDK, which manages the session cookie directly. No custom `/api/auth/*` routes exist.

---

## 5. Middleware — Route Protection

`middleware.ts` at the project root:

- Runs on every request matching `/dashboard/:path*` and `/api/:path*` (config `matcher`)
- Refreshes the Supabase session cookie on each request (required by `@supabase/ssr` to keep server components in sync with client-side auth state)
- If no valid session is found for a matched path:
  - For `/dashboard/*` (page routes): redirect (302) to `/sign-in`
  - For `/api/*` (API routes): return `401 { error: { code: 'unauthorized', message: 'Authentication required' } }` as JSON, not a redirect

---

## 6. Edge Cases

| Case | Handling |
|---|---|
| User clicks an expired confirmation link | `/auth/callback` redirects to `/sign-in?error=invalid_or_expired_link`; sign-in page shows "Your confirmation link expired. Try signing up again or contact support." |
| User tries to sign in before confirming email | Supabase returns an "email not confirmed" error; surfaced as "Please confirm your email before signing in — check your inbox." |
| User is already signed in and visits `/sign-in` or `/sign-up` | Client-side check on mount (`supabase.auth.getSession()`); if a session exists, redirect immediately to `/dashboard` |
| Session expires while the user is mid-session on a protected page | Middleware catches this on the next navigation/API call and redirects/401s; the frontend's Supabase client also listens for `onAuthStateChange` and redirects to `/sign-in` client-side if the session drops to `null` |
| Double-submit (user clicks "Sign Up" twice quickly) | Submit button is disabled while the request is in flight |

---

## 7. Acceptance Criteria

- [ ] A new user can sign up with email + password and receives a confirmation email
- [ ] Clicking the confirmation link establishes a session and lands on `/dashboard`
- [ ] A confirmed user can sign in and is redirected to `/dashboard` within 10 seconds (US-001)
- [ ] An unconfirmed or invalid sign-in attempt shows a clear, non-enumerating error message (US-001)
- [ ] Signing out clears the session and redirects to `/`
- [ ] Visiting `/dashboard` or any `/api/*` route while unauthenticated redirects (pages) or returns `401` (API) — never renders protected content
- [ ] A signed-in user visiting `/sign-in` or `/sign-up` is redirected to `/dashboard`
