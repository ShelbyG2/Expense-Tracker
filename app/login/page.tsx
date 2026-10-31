'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LoginSchema } from '@/schemas/auth'

type FieldErrors = Record<string, string[]>

// useSearchParams needs a Suspense boundary while the page is prerendered.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

const REASON_MESSAGES: Record<string, string> = {
  deactivated:
    'Your account has been deactivated. Contact an administrator to regain access.',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reasonMessage =
    REASON_MESSAGES[searchParams.get('reason') ?? ''] ?? null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    // Client-side validation with the shared schema.
    const parsed = LoginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormError(data.error ?? 'Unable to sign in')
        return
      }
      const data = await res.json().catch(() => ({}))
      // An admin-set temporary password must be changed before anything else
      // (Phase 7A); the protected layout enforces it too.
      const target = data.user?.mustChangePassword
        ? '/account/change-password'
        : '/dashboard'
      // replace() so the back button doesn't return to the login form. The
      // dashboard is dynamic and refetched on navigation, so no refresh().
      router.replace(target)
    } catch {
      setFormError('Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Expense Tracker — Management Information System
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {reasonMessage && (
            <p
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {reasonMessage}
            </p>
          )}
          {formError && (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {formError}
            </p>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.email[0]}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.password[0]}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-neutral-500">
          No account yet?{' '}
          <Link href="/register" className="font-medium underline">
            Create an organization
          </Link>
        </p>
      </div>
    </main>
  )
}
