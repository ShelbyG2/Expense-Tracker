import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { listExpenses, type ExpenseView } from '@/services/expense-service'
import { getOrganizationSettings } from '@/services/organization-service'
import { ExpenseListQuerySchema } from '@/schemas/expense'
import { formatAmount, formatDateOnly } from '@/lib/format'
import { CATEGORIES, EXPENSE_STATUSES } from '@/lib/constants'
import { DeleteExpenseButton } from '@/components/delete-expense-button'

// Reads the session cookie and search params on every request.
export const instant = false

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const STATUS_STYLES: Record<ExpenseView['status'], string> = {
  pending:
    'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  approved:
    'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
}

const selectClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const raw = await searchParams
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const v = first(value)
    if (v) rawQuery[key] = v
  }

  // Invalid query strings fall back to defaults instead of erroring the page.
  const parsed = ExpenseListQuerySchema.safeParse(rawQuery)
  const query = parsed.success ? parsed.data : ExpenseListQuerySchema.parse({})

  // Keep the parsed Date objects out of the URL builder.
  const queryStrings: Record<string, string> = {
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  }
  if (query.category) queryStrings.category = query.category
  if (query.status) queryStrings.status = query.status
  if (query.from) queryStrings.from = query.from.toISOString().slice(0, 10)
  if (query.to) queryStrings.to = query.to.toISOString().slice(0, 10)
  if (query.pageSize !== 20) queryStrings.pageSize = String(query.pageSize)

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    const merged = { ...queryStrings, ...overrides }
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value)
    }
    const qs = params.toString()
    return qs ? `/expenses?${qs}` : '/expenses'
  }

  const [result, settings] = await Promise.all([
    listExpenses(session, query),
    getOrganizationSettings(session),
  ])

  const scopeNote: Record<typeof session.role, string> = {
    staff: 'Your expenses',
    manager: 'Expenses in your department, plus your own',
    admin: 'All expenses in your organization',
  }

  const sortLink = (field: 'date' | 'amount') => {
    const dir =
      query.sortBy === field && query.sortDir === 'desc' ? 'asc' : 'desc'
    return buildUrl({ sortBy: field, sortDir: dir, page: undefined })
  }

  const sortIndicator = (field: 'date' | 'amount') =>
    query.sortBy === field ? (query.sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const to = Math.min(result.page * result.pageSize, result.total)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {scopeNote[session.role]}
          </p>
          {session.role === 'manager' && !session.departmentId && (
            <p className="mt-1 text-xs text-neutral-500">
              No department is assigned to you yet, so there are no expenses to
              show.
            </p>
          )}
        </div>
        {/* Managers record their own expenses too (Phase 7B). */}
        {session.role !== 'admin' && (
          <Link
            href="/expenses/new"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            New expense
          </Link>
        )}
      </div>

      <form
        method="get"
        action="/expenses"
        className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-neutral-800"
      >
        <input type="hidden" name="sortBy" value={query.sortBy} />
        <input type="hidden" name="sortDir" value={query.sortDir} />

        <div>
          <label htmlFor="category" className="block text-xs font-medium">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={query.category ?? ''}
            className={selectClass}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="status" className="block text-xs font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status ?? ''}
            className={selectClass}
          >
            <option value="">All statuses</option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="from" className="block text-xs font-medium">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={query.from?.toISOString().slice(0, 10) ?? ''}
            className={selectClass}
          />
        </div>

        <div>
          <label htmlFor="to" className="block text-xs font-medium">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={query.to?.toISOString().slice(0, 10) ?? ''}
            className={selectClass}
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Apply
          </button>
          <Link
            href="/expenses"
            className="px-2 py-1.5 text-sm text-neutral-600 underline dark:text-neutral-300"
          >
            Reset
          </Link>
        </div>
      </form>

      {parsed.success === false && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Some filters were invalid, so the list shows the defaults.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            Expenses — page {result.page} of {result.totalPages}
          </caption>
          <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
            <tr>
              <th scope="col" className="px-4 py-3">
                <Link
                  href={sortLink('date')}
                  className="hover:underline"
                  aria-label={`Sort by date${sortIndicator('date')}`}
                >
                  Date{sortIndicator('date')}
                </Link>
              </th>
              <th scope="col" className="px-4 py-3">
                Category
              </th>
              <th scope="col" className="px-4 py-3">
                Description
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                <Link
                  href={sortLink('amount')}
                  className="hover:underline"
                  aria-label={`Sort by amount${sortIndicator('amount')}`}
                >
                  Amount{sortIndicator('amount')}
                </Link>
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-neutral-500"
                >
                  No expenses match these filters.{' '}
                  <Link href="/expenses" className="underline">
                    Clear filters
                  </Link>
                </td>
              </tr>
            ) : (
              result.items.map((expense) => {
                // Owner only, pending only — same rule for staff and managers
                // (an admin never owns an expense).
                const canManage =
                  expense.userId === session.userId &&
                  expense.status === 'pending'

                return (
                  <tr
                    key={expense.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateOnly(expense.date)}
                    </td>
                    <td className="px-4 py-3">{expense.category}</td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                      {expense.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatAmount(expense.amount, settings.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[expense.status]}`}
                      >
                        {expense.status}
                      </span>
                      {expense.reviewNote && (
                        <span className="mt-1 block max-w-56 text-xs text-neutral-500">
                          {expense.reviewNote}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {canManage ? (
                        <span className="flex items-center gap-3">
                          <Link
                            href={`/expenses/${expense.id}/edit`}
                            className="text-sm font-medium underline"
                          >
                            Edit
                          </Link>
                          <DeleteExpenseButton expenseId={expense.id} />
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
        <p>
          Showing {from}–{to} of {result.total}
        </p>
        <div className="flex items-center gap-2">
          {result.page > 1 ? (
            <Link
              href={buildUrl({ page: String(result.page - 1) })}
              className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-3 py-1.5 opacity-40 dark:border-neutral-800">
              Previous
            </span>
          )}
          <span>
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link
              href={buildUrl({ page: String(result.page + 1) })}
              className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-3 py-1.5 opacity-40 dark:border-neutral-800">
              Next
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
