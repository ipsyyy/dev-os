'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignUpPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [router, supabase])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (!EMAIL_PATTERN.test(email)) {
      setFieldError('Enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setFieldError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setFieldError('Passwords do not match.')
      return
    }
    setFieldError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    })

    setSubmitting(false)

    if (error) {
      setSubmitError(
        "If this email isn't already registered, check your inbox for a confirmation link."
      )
      return
    }

    setCheckEmail(true)
  }

  if (checkEmail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-grey-25 px-4 font-sans">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="type-h5 text-grey-900">Check your email</h1>
          <p className="type-body-lg mt-4 text-grey-500">
            We sent a confirmation link to <span className="text-grey-900">{email}</span>.
            Click it to activate your account.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-grey-25 px-4 font-sans">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <h1 className="type-h5 text-grey-900">Sign up</h1>

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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="type-body-lg rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor="confirmPassword" className="type-body-sm text-grey-500">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="type-body-lg rounded-md border border-grey-100 px-3 py-2 text-grey-900 outline-none focus:border-blue-500"
          />
        </div>

        {(fieldError || submitError) && (
          <p className="type-body-sm mt-4 text-red-500">{fieldError ?? submitError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="type-body-lg mt-6 w-full rounded-md bg-blue-500 py-2 text-white transition-transform duration-100 ease-out hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-grey-100 disabled:text-grey-400 disabled:hover:scale-100"
        >
          {submitting ? 'Creating account…' : 'Sign up'}
        </button>

        <p className="type-body-sm mt-6 text-center text-grey-500">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-blue-500">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  )
}
