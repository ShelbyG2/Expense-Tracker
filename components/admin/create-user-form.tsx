'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { USER_ROLES } from '@/lib/constants'
import { CreateUserSchema } from '@/schemas/admin'
import { useToast } from '@/components/toast'
import type { AdminDepartmentView } from '@/services/admin-service'

type FieldErrors = Record<string, string[]>

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
}

// Inline "create user" form above the users table.
export function CreateUserForm({
  departments,
}: {
  departments: AdminDepartmentView[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('staff')
  const [departmentId, setDepartmentId] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = CreateUserSchema.safeParse({
      name,
      email,
      password,
      role,
      departmentId: departmentId === '' ? null : departmentId,
    })
    if (!parsed.success) {
      setFieldErrors(z.flattenError(parsed.error).fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const details = data.details?.fieldErrors as FieldErrors | undefined
        if (details) setFieldErrors(details)
        setFormError(data.error ?? 'Unable to create the user')
        return
      }
      toast('User created')
      setName('')
      setEmail('')
      setPassword('')
      setRole('staff')
      setDepartmentId('')
      router.refresh()
    } catch {
      setFormError('Unable to create the user. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="create-user-heading"
      className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="create-user-heading" className="text-base font-semibold">
        Create user
      </h2>
      <form onSubmit={handleSubmit} noValidate className="mt-3">
        {formError && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {formError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label
              htmlFor="new-user-name"
              className="block text-sm font-medium"
            >
              Name
            </label>
            <input
              id="new-user-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!fieldErrors.name}
              className={inputClass}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.name[0]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-user-email"
              className="block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="new-user-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              className={inputClass}
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.email[0]}
              </p>
            )}
            <p className="mt-1 text-xs text-neutral-500">
              An email address belongs to one organization only.
            </p>
          </div>

          <div>
            <label
              htmlFor="new-user-password"
              className="block text-sm font-medium"
            >
              Initial password
            </label>
            <input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-neutral-500">
              At least 8 characters. Share it with the user; it is never shown
              again.
            </p>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.password[0]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-user-role"
              className="block text-sm font-medium"
            >
              Role
            </label>
            <select
              id="new-user-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-invalid={!!fieldErrors.role}
              className={inputClass}
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
            {fieldErrors.role && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.role[0]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="new-user-department"
              className="block text-sm font-medium"
            >
              Department
            </label>
            <select
              id="new-user-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              aria-invalid={!!fieldErrors.departmentId}
              className={inputClass}
            >
              <option value="">No department</option>
              {departments
                .filter((dept) => !dept.isArchived)
                .map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
            </select>
            {fieldErrors.departmentId && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.departmentId[0]}
              </p>
            )}
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {busy ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
