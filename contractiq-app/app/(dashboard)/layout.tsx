'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="flex h-screen flex-col bg-grey-25 font-sans">
      <header className="flex shrink-0 items-center justify-between border-b border-grey-100 bg-white px-6 py-4">
        <Link href="/dashboard" className="type-h5 text-grey-900">
          ContractIQ
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="type-body-sm rounded-md border border-grey-100 px-3 py-1.5 text-grey-700 hover:bg-grey-50"
        >
          Sign Out
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
