'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired_link:
    'Your confirmation link expired. Try signing up again or contact support.',
  missing_code: 'That confirmation link is invalid. Try signing up again.',
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [router, supabase])

  useEffect(() => {
    const callbackError = searchParams.get('error')
    if (callbackError) {
      setSubmitError(CALLBACK_ERROR_MESSAGES[callbackError] ?? 'Something went wrong. Try again.')
    }
  }, [searchParams])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setSubmitting(false)

    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setSubmitError('Please confirm your email before signing in — check your inbox.')
      } else {
        setSubmitError('Invalid email or password.')
      }
      return
    }

    router.replace('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-grey-25 px-4 font-sans">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <h1 className="type-h5 text-grey-900">Sign in</h1>

        <div className="mt-6 flex flex-col gap-1">
          <label htmlFor="email" className="type-body-sm text-grey-500">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="type-body-lg rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor="password" className="type-body-sm text-grey-500">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="type-body-lg rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
          />
        </div>

        {submitError && <p className="type-body-sm mt-4 text-red-500">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="type-body-lg mt-6 w-full rounded-md bg-blue-500 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400 disabled:hover:scale-100"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="type-body-sm mt-6 text-center text-grey-500">
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="text-blue-500">
            Sign up
          </Link>
        </p>
      </form>
    </main>
  )
}
