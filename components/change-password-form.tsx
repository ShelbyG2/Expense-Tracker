'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChangePasswordSchema } from '@/schemas/auth'

type FieldErrors = Record<string, string[]>

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

// Shared by /account (voluntary) and /account/change-password (forced by an
// admin-set temporary password). Posts to /api/account/password, which
// requires the current password and clears the mustChangePassword flag.
export function ChangePasswordForm() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    // Client-side validation with the shared schema.
    const parsed = ChangePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormError(data.error ?? 'Unable to change your password')
        return
      }
      // replace() so the back button doesn't return to the change form.
      router.replace('/dashboard')
      router.refresh()
    } catch {
      setFormError('Unable to change your password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
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
        <label htmlFor="currentPassword" className="block text-sm font-medium">
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          aria-invalid={!!fieldErrors.currentPassword}
          className={inputClass}
        />
        {fieldErrors.currentPassword && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.currentPassword[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={!!fieldErrors.newPassword}
          className={inputClass}
        />
        {fieldErrors.newPassword && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.newPassword[0]}
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-500">At least 8 characters.</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          aria-invalid={!!fieldErrors.confirmPassword}
          className={inputClass}
        />
        {fieldErrors.confirmPassword && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.confirmPassword[0]}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
