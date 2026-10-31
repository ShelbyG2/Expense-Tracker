'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { DepartmentNameSchema } from '@/schemas/admin'
import { useToast } from '@/components/toast'

type FieldErrors = Record<string, string[]>

const inputClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

// Inline "create department" form above the departments table.
export function DepartmentForm() {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const parsed = DepartmentNameSchema.safeParse({ name })
    if (!parsed.success) {
      setFieldErrors(z.flattenError(parsed.error).fieldErrors as FieldErrors)
      return
    }
    setFieldErrors({})

    setBusy(true)
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const details = data.details?.fieldErrors as FieldErrors | undefined
        if (details) setFieldErrors(details)
        setFormError(data.error ?? 'Unable to create the department')
        return
      }
      toast('Department created')
      setName('')
      router.refresh()
    } catch {
      setFormError('Unable to create the department. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="create-department-heading"
      className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="create-department-heading" className="text-base font-semibold">
        Create department
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <label
              htmlFor="new-dept-name"
              className="block text-sm font-medium"
            >
              Department name
            </label>
            <input
              id="new-dept-name"
              required
              maxLength={80}
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
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {busy ? 'Creating…' : 'Create department'}
          </button>
        </div>
      </form>
    </section>
  )
}
