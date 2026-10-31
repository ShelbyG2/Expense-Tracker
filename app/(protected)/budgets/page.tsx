import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { listBudgets } from '@/services/budget-service'
import { BudgetListQuerySchema } from '@/schemas/budget'
import { departmentNames } from '@/services/directory-service'
import { getOrganizationSettings } from '@/services/organization-service'
import { formatAmount, currentMonth } from '@/lib/format'
import { CATEGORIES } from '@/lib/constants'
import { BudgetForm } from '@/components/budget-form'
import { CopyBudgetsForm } from '@/components/copy-budgets-form'
import { DeleteBudgetButton } from '@/components/delete-budget-button'

// Reads the session cookie and search params on every request.
export const instant = false

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const selectClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Staff have no budget access in this phase.
  if (session.role === 'staff') redirect('/dashboard')

  const raw = await searchParams
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const v = first(value)
    if (v) rawQuery[key] = v
  }

  // Invalid query strings fall back to defaults instead of erroring the page.
  const parsed = BudgetListQuerySchema.safeParse(rawQuery)
  const query = parsed.success ? parsed.data : {}
  const [result, settings] = await Promise.all([
    listBudgets(session, query),
    getOrganizationSettings(session),
  ])

  const canEdit = session.role === 'manager' && !!session.departmentId
  const names =
    session.role === 'admin'
      ? await departmentNames(
          session,
          result.items.map((b) => b.departmentId),
        )
      : {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Budgets</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {session.role === 'manager'
            ? 'Category budgets for your department.'
            : 'All department budgets in your organization (read-only).'}
        </p>
        {session.role === 'manager' && !session.departmentId && (
          <p className="mt-1 text-xs text-neutral-500">
            No department is assigned to you yet, so you cannot set budgets.
          </p>
        )}
      </div>

      {canEdit && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-semibold">Set a budget</h2>
          <BudgetForm
            mode="create"
            idPrefix="new-budget"
            initial={{ month: query.month ?? currentMonth() }}
          />
        </section>
      )}

      {canEdit && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Copy budgets from a month</h2>
          <p className="mt-1 mb-3 text-xs text-neutral-500">
            Start a new month from an existing one instead of retyping every
            category.
          </p>
          <CopyBudgetsForm />
        </section>
      )}

      <form
        method="get"
        action="/budgets"
        className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-4 sm:grid-cols-3 dark:border-neutral-800"
      >
        <div>
          <label htmlFor="month" className="block text-xs font-medium">
            Month
          </label>
          <input
            id="month"
            name="month"
            type="month"
            defaultValue={query.month ?? ''}
            className={selectClass}
          />
        </div>

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

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Apply
          </button>
          <Link
            href="/budgets"
            className="px-2 py-1.5 text-sm text-neutral-600 underline dark:text-neutral-300"
          >
            Reset
          </Link>
        </div>
      </form>

      {parsed.success === false && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Some filters were invalid, so the list shows all budgets.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
            <tr>
              <th scope="col" className="px-4 py-3">
                Month
              </th>
              <th scope="col" className="px-4 py-3">
                Category
              </th>
              {session.role === 'admin' && (
                <th scope="col" className="px-4 py-3">
                  Department
                </th>
              )}
              <th scope="col" className="px-4 py-3 text-right">
                Amount
              </th>
              {canEdit && (
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={session.role === 'admin' ? 4 : 3}
                  className="px-4 py-10 text-center text-neutral-500"
                >
                  No budgets yet.{' '}
                  {canEdit
                    ? 'Set the first one above.'
                    : 'A manager sets budgets for their department.'}
                </td>
              </tr>
            ) : (
              result.items.map((budget) => (
                <tr
                  key={budget.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    {budget.month}
                  </td>
                  <td className="px-4 py-3">{budget.category}</td>
                  {session.role === 'admin' && (
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                      {names[budget.departmentId] ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatAmount(budget.amount, settings.currency)}
                    {budget.carryOver && (
                      <span className="mt-1 block text-xs text-neutral-500">
                        carries over
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-3">
                        <Link
                          href={`/budgets/${budget.id}/edit`}
                          className="text-sm font-medium underline"
                        >
                          Edit
                        </Link>
                        <DeleteBudgetButton budgetId={budget.id} />
                      </span>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-neutral-500">
        {result.total} budget{result.total === 1 ? '' : 's'}
        {query.month ? ` for ${query.month}` : ''}.
      </p>
    </div>
  )
}
