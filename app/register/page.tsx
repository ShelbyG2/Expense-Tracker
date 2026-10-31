'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RegisterSchema } from '@/schemas/auth'

type FieldErrors = Record<string, string[]>

export default function RegisterPage() {
  const router = useRouter()
  const [organizationName, setOrganizationName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = RegisterSchema.safeParse({
      organizationName,
      name,
      email,
      password,
    })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormError(data.error ?? 'Could not create account')
        return
      }
      // Same as login: replace the auth page in history and let the dynamic
      // dashboard refetch on navigation.
      router.replace('/dashboard')
    } catch {
      setFormError('Could not create account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create an organization
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            You&apos;ll be the first admin user.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError && (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {formError}
            </p>
          )}

          <div>
            <label
              htmlFor="organizationName"
              className="block text-sm font-medium"
            >
              Organization name
            </label>
            <input
              id="organizationName"
              type="text"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              aria-invalid={!!fieldErrors.organizationName}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
            />
            {fieldErrors.organizationName && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.organizationName[0]}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium">
              Your name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!fieldErrors.name}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.name[0]}
              </p>
            )}
          </div>

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
            <p className="mt-1 text-xs text-neutral-500">
              An email address belongs to one organization only. If it is
              already in use, ask that organization&apos;s admin for an account.
            </p>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
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
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-neutral-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
