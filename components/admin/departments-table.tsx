'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { DepartmentNameSchema } from '@/schemas/admin'
import { useToast } from '@/components/toast'
import type { AdminDepartmentView } from '@/services/admin-service'

const inputClass =
  'w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

const buttonClass =
  'rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'

const secondaryButtonClass =
  'rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900'

const dangerButtonClass =
  'rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40'

function referenceSummary(department: AdminDepartmentView): string {
  return [
    `${department.userCount} user${department.userCount === 1 ? '' : 's'}`,
    `${department.budgetCount} budget${department.budgetCount === 1 ? '' : 's'}`,
    `${department.expenseCount} expense${department.expenseCount === 1 ? '' : 's'}`,
  ].join(' · ')
}

function DepartmentRow({ department }: { department: AdminDepartmentView }) {
  const router = useRouter()
  const { toast } = useToast()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(department.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function rename(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = DepartmentNameSchema.safeParse({ name })
    if (!parsed.success) {
      setError(
        z.flattenError(parsed.error).fieldErrors.name?.[0] ?? 'Invalid name',
      )
      return
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/admin/departments/${department.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to rename the department')
        return
      }
      toast('Department renamed')
      setRenaming(false)
      router.refresh()
    } catch {
      setError('Unable to rename the department. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function setArchived(archived: boolean) {
    const message = archived
      ? `Archive ${department.name}? Its name stays in historical reports, but it cannot receive new users, budgets or expenses until unarchived.`
      : `Unarchive ${department.name}? It will accept new users, budgets and expenses again.`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/departments/${department.id}/${archived ? 'archive' : 'unarchive'}`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(
          data.error ??
            `Unable to ${archived ? 'archive' : 'unarchive'} the department`,
        )
        return
      }
      toast(archived ? 'Department archived' : 'Department unarchived')
      router.refresh()
    } catch {
      setError(
        `Unable to ${archived ? 'archive' : 'unarchive'} the department. Please try again.`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const references = referenceSummary(department)
    const message =
      department.userCount > 0 ||
      department.budgetCount > 0 ||
      department.expenseCount > 0
        ? `Delete ${department.name} permanently? It still has ${references}, so this will be refused until those records are removed or moved.`
        : `Delete ${department.name} permanently? This cannot be undone.`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/departments/${department.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to delete the department')
        return
      }
      toast('Department deleted')
      router.refresh()
    } catch {
      setError('Unable to delete the department. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (renaming) {
    return (
      <tr className="border-t border-neutral-200 dark:border-neutral-800">
        <td colSpan={3} className="px-3 py-2">
          <form
            onSubmit={rename}
            noValidate
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor={`rename-${department.id}`} className="sr-only">
              New name for {department.name}
            </label>
            <input
              id={`rename-${department.id}`}
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setName(department.name)
                setRenaming(false)
                setError(null)
              }}
              className="text-sm text-neutral-600 underline dark:text-neutral-300"
            >
              Cancel
            </button>
            {error && (
              <p
                role="alert"
                className="w-full text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
          </form>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-neutral-200 dark:border-neutral-800">
      <td className="px-3 py-2 text-sm font-medium">
        {department.name}
        {department.isArchived && (
          <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            Archived
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300">
        {referenceSummary(department)}
      </td>
      <td className="px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setRenaming(true)}
            className="text-sm font-medium text-neutral-700 underline disabled:opacity-50 dark:text-neutral-300"
          >
            Rename
          </button>
          {department.isArchived ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setArchived(false)}
              className={secondaryButtonClass}
            >
              Unarchive
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setArchived(true)}
              className={secondaryButtonClass}
            >
              Archive
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className={dangerButtonClass}
          >
            Delete
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-1 text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}

export function DepartmentsTable({
  departments,
}: {
  departments: AdminDepartmentView[]
}) {
  if (departments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No departments yet. Create one above, then assign users to it.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[560px] text-left">
        <thead className="bg-neutral-50 text-xs font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th scope="col" className="px-3 py-2">
              Department
            </th>
            <th scope="col" className="px-3 py-2">
              In use by
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {departments.map((department) => (
            <DepartmentRow key={department.id} department={department} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
