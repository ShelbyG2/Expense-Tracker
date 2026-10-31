import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { listAuditLogs } from '@/services/audit-service'
import { listUsers } from '@/services/admin-service'
import { AuditQuerySchema } from '@/schemas/audit'
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@/lib/constants'

// Reads the session cookie and search params on every request.
export const instant = false

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const controlClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  approve: 'Approved',
  reject: 'Rejected',
}

// UTC timestamp without seconds — the audit page is server-rendered, so this
// does not need to match a browser locale.
function formatTimestamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/dashboard')

  const raw = await searchParams
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const v = first(value)
    if (v) rawQuery[key] = v
  }

  // Invalid filters fall back to the unfiltered first page instead of erroring.
  const parsed = AuditQuerySchema.safeParse(rawQuery)
  const query = parsed.success ? parsed.data : AuditQuerySchema.parse({})
  const filtersInvalid = !parsed.success && Object.keys(rawQuery).length > 0

  const [result, users] = await Promise.all([
    listAuditLogs(session, query),
    listUsers(session),
  ])

  // Preserve the active filters when paging.
  const buildUrl = (page: number) => {
    const params = new URLSearchParams()
    if (query.userId) params.set('userId', query.userId)
    if (query.entity) params.set('entity', query.entity)
    if (query.action) params.set('action', query.action)
    if (query.from) params.set('from', query.from.toISOString().slice(0, 10))
    if (query.to) params.set('to', query.to.toISOString().slice(0, 10))
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return qs ? `/admin/audit?${qs}` : '/admin/audit'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every create, update, delete, approve and reject in your organization.
          Read-only, newest first.
        </p>
      </div>

      <form
        method="get"
        action="/admin/audit"
        className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-6 dark:border-neutral-800"
      >
        <div className="lg:col-span-2">
          <label htmlFor="audit-user" className="block text-xs font-medium">
            User
          </label>
          <select
            id="audit-user"
            name="userId"
            defaultValue={query.userId ?? ''}
            className={controlClass}
          >
            <option value="">Anyone</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-entity" className="block text-xs font-medium">
            Entity
          </label>
          <select
            id="audit-entity"
            name="entity"
            defaultValue={query.entity ?? ''}
            className={controlClass}
          >
            <option value="">Any entity</option>
            {AUDIT_ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-action" className="block text-xs font-medium">
            Action
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={query.action ?? ''}
            className={controlClass}
          >
            <option value="">Any action</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action] ?? action}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-from" className="block text-xs font-medium">
            From
          </label>
          <input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={
              query.from ? query.from.toISOString().slice(0, 10) : ''
            }
            className={controlClass}
          />
        </div>

        <div>
          <label htmlFor="audit-to" className="block text-xs font-medium">
            To
          </label>
          <input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={query.to ? query.to.toISOString().slice(0, 10) : ''}
            className={controlClass}
          />
        </div>

        <div className="flex items-end gap-2 lg:col-span-6">
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Apply filters
          </button>
          <Link
            href="/admin/audit"
            className="px-2 py-1.5 text-sm text-neutral-600 underline dark:text-neutral-300"
          >
            Reset
          </Link>
        </div>
      </form>

      {filtersInvalid && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Some filters were invalid, so the log shows the newest entries.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
            <tr>
              <th scope="col" className="px-4 py-3">
                When
              </th>
              <th scope="col" className="px-4 py-3">
                User
              </th>
              <th scope="col" className="px-4 py-3">
                Action
              </th>
              <th scope="col" className="px-4 py-3">
                Entity
              </th>
              <th scope="col" className="px-4 py-3">
                Record
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-neutral-500"
                >
                  No audit entries match these filters.
                </td>
              </tr>
            ) : (
              result.items.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td
                    className="px-4 py-3 whitespace-nowrap tabular-nums"
                    title={entry.createdAt}
                  >
                    {formatTimestamp(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {entry.userName ?? (
                      <span className="text-neutral-500">
                        Unknown user ({entry.userId})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </td>
                  <td className="px-4 py-3">{entry.entity}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {entry.entityId}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
        <p>
          {result.total} entr{result.total === 1 ? 'y' : 'ies'} · page{' '}
          {result.page} of {result.totalPages}
        </p>
        <div className="flex gap-3">
          {result.page > 1 && (
            <Link href={buildUrl(result.page - 1)} className="underline">
              Previous
            </Link>
          )}
          {result.page < result.totalPages && (
            <Link href={buildUrl(result.page + 1)} className="underline">
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
