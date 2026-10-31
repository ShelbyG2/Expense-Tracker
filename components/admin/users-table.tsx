'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { USER_ROLES } from '@/lib/constants'
import { useToast } from '@/components/toast'
import type {
  AdminDepartmentView,
  AdminUserView,
} from '@/services/admin-service'

const inputClass =
  'w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
}

const buttonClass =
  'rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'

const dangerButtonClass =
  'rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40'

// One table row: role and department are edited in place; status toggles
// with a confirmation. The server re-checks every rule (an admin cannot
// demote or deactivate themselves; the org keeps one active admin).
function UserRow({
  user,
  departments,
  isSelf,
}: {
  user: AdminUserView
  departments: AdminDepartmentView[]
  isSelf: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [role, setRole] = useState(user.role)
  const [departmentId, setDepartmentId] = useState(user.departmentId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Shown once after a password reset; only ever the plaintext the server
  // returned in this response — it is never stored or re-fetchable.
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  )

  const dirty = role !== user.role || departmentId !== user.departmentId

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, departmentId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to save the user')
        return
      }
      toast('Changes saved')
      router.refresh()
    } catch {
      setError('Unable to save the user. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive() {
    const activating = !user.isActive
    const message = activating
      ? `Reactivate ${user.name}? They will be able to sign in again.`
      : `Deactivate ${user.name}? They will be signed out and cannot sign in.`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: activating }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to change the user status')
        return
      }
      toast(activating ? 'User reactivated' : 'User deactivated')
      router.refresh()
    } catch {
      setError('Unable to change the user status. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    const message = `Reset the password for ${user.name}? A temporary password will be generated and they must change it before signing in.`
    if (!window.confirm(message)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unable to reset the password')
        return
      }
      const data = (await res.json()) as { temporaryPassword: string }
      setTemporaryPassword(data.temporaryPassword)
      toast('Temporary password created')
      router.refresh()
    } catch {
      setError('Unable to reset the password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copyPassword() {
    if (!temporaryPassword) return
    try {
      await navigator.clipboard.writeText(temporaryPassword)
      toast('Temporary password copied')
    } catch {
      setError('Could not copy — select the password and copy it manually.')
    }
  }

  return (
    <>
      <tr className="border-t border-neutral-200 dark:border-neutral-800">
        <td className="px-3 py-2 text-sm font-medium">
          {user.name}
          {isSelf && (
            <span className="ml-1 font-normal text-neutral-500">(you)</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300">
          {user.email}
        </td>
        <td className="px-3 py-2 text-sm">
          <label htmlFor={`role-${user.id}`} className="sr-only">
            Role for {user.name}
          </label>
          <select
            id={`role-${user.id}`}
            value={role}
            disabled={isSelf || busy}
            onChange={(e) => setRole(e.target.value as typeof user.role)}
            className={inputClass}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 text-sm">
          <label htmlFor={`dept-${user.id}`} className="sr-only">
            Department for {user.name}
          </label>
          <select
            id={`dept-${user.id}`}
            value={departmentId ?? ''}
            disabled={busy}
            onChange={(e) => setDepartmentId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">No department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id} disabled={dept.isArchived}>
                {dept.name}
                {dept.isArchived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2 text-sm">
          <span
            className={
              user.isActive
                ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950/50 dark:text-green-300'
                : 'rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
            }
          >
            {user.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className={buttonClass}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {!isSelf && (
              <>
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={busy}
                  className={dangerButtonClass}
                >
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={busy}
                  className={buttonClass}
                >
                  Reset password
                </button>
              </>
            )}
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
      {temporaryPassword && (
        <tr className="bg-amber-50/60 dark:bg-amber-950/20">
          <td colSpan={6} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                Temporary password for {user.email}:
              </span>
              <code className="rounded bg-neutral-100 px-2 py-0.5 font-mono dark:bg-neutral-800">
                {temporaryPassword}
              </code>
              <button
                type="button"
                onClick={copyPassword}
                className="text-xs font-medium underline"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setTemporaryPassword(null)}
                className="text-xs underline"
              >
                Dismiss
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              Give this to the user. They must change it at next sign-in and
              cannot use the app until they do.
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

export function UsersTable({
  users,
  departments,
  currentUserId,
}: {
  users: AdminUserView[]
  departments: AdminDepartmentView[]
  currentUserId: string
}) {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No users yet. Create the first one above.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[720px] text-left">
        <thead className="bg-neutral-50 text-xs font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th scope="col" className="px-3 py-2">
              Name
            </th>
            <th scope="col" className="px-3 py-2">
              Email
            </th>
            <th scope="col" className="px-3 py-2">
              Role
            </th>
            <th scope="col" className="px-3 py-2">
              Department
            </th>
            <th scope="col" className="px-3 py-2">
              Status
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              departments={departments}
              isSelf={user.id === currentUserId}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
