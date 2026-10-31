import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { ReportQuerySchema } from '@/schemas/report'
import {
  budgetVsActual,
  spendingTrends,
  summaryReport,
} from '@/services/report-service'
import { getOrganizationSettings } from '@/services/organization-service'
import { currentMonth, formatAmount } from '@/lib/format'
import { BudgetVsActualTable } from '@/components/budget-vs-actual-table'
import { CategoryChart, TrendChart } from '@/components/report-charts'

// Reads the session cookie and search params on every request.
export const instant = false

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const controlClass =
  'mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700'

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </div>
  )
}

function BreakdownTable({
  caption,
  rows,
  currency,
}: {
  caption: string
  rows: { name: string; total: number }[]
  currency: string
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
          <tr>
            <th scope="col" className="px-4 py-3">
              {caption}
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Approved
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
            >
              <td className="px-4 py-2.5">{row.name}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatAmount(row.total, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  // Staff read their department's budget status from the dashboard instead;
  // middleware already 403s this path for them.
  if (session.role === 'staff') redirect('/dashboard')

  const raw = await searchParams
  const parsed = ReportQuerySchema.safeParse({ month: first(raw.month) })
  const monthInvalid = !parsed.success && first(raw.month) !== undefined
  const month = parsed.success
    ? (parsed.data.month ?? currentMonth())
    : currentMonth()

  const [summary, rows, trends, settings] = await Promise.all([
    summaryReport(session, month),
    budgetVsActual(session, month),
    spendingTrends(session),
    getOrganizationSettings(session),
  ])
  const warningPercent = Math.round(settings.warningThreshold * 100)

  const hasTrend = trends.some((point) => point.total > 0)
  const hasCategoryData = summary.byCategory.some((row) => row.total > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {session.role === 'admin'
            ? 'Approved spending, budget usage and trends across your organization.'
            : 'Approved spending, budget usage and trends for your department.'}
        </p>
      </div>

      <div className="print-hide flex flex-wrap items-end justify-between gap-3">
        <form
          method="get"
          action="/reports"
          className="print-hide flex items-end gap-2"
        >
          <div>
            <label htmlFor="report-month" className="block text-xs font-medium">
              Month
            </label>
            <input
              id="report-month"
              name="month"
              type="month"
              defaultValue={month}
              className={`${controlClass} w-44`}
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Apply
          </button>
        </form>

        <div className="flex flex-wrap gap-4 text-sm">
          <a
            href={`/api/reports/export?report=summary&format=csv&month=${month}`}
            className="underline"
          >
            Summary CSV
          </a>
          <a
            href={`/api/reports/export?report=summary&format=xlsx&month=${month}`}
            className="underline"
          >
            Summary XLSX
          </a>
          <a
            href={`/api/reports/export?report=budget&format=csv&month=${month}`}
            className="underline"
          >
            Budget vs actual CSV
          </a>
          <a
            href={`/api/reports/export?report=budget&format=xlsx&month=${month}`}
            className="underline"
          >
            Budget vs actual XLSX
          </a>
        </div>
      </div>

      {monthInvalid && (
        <p className="text-sm text-red-600 dark:text-red-400">
          That month was not valid, so the report shows {month}.
        </p>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label={`Total approved — ${month}`}
          value={formatAmount(summary.totalApproved, settings.currency)}
          hint="Approved expenses only."
        />
        <StatCard
          label={`Awaiting approval — ${month}`}
          value={formatAmount(summary.awaitingApproval, settings.currency)}
          hint="Pending expenses; never counted toward budgets."
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs actual</h2>
          <p className="text-sm text-neutral-500">
            {month} · below {warningPercent}% is on track, {warningPercent}–
            100% is a warning, above 100% is exceeded. Approved spending in a
            category without a budget is listed as “No budget”.
          </p>
        </div>
        <BudgetVsActualTable
          rows={rows}
          currency={settings.currency}
          showDepartment={session.role === 'admin'}
          emptyMessage={`No budgets for ${month} yet.`}
        />
        {rows.length === 0 && session.role === 'manager' && (
          <p className="print-hide text-sm">
            <Link href="/budgets" className="underline">
              Set budgets for {month}
            </Link>
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Approved spending breakdown — {month}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownTable
            caption="Category"
            currency={settings.currency}
            rows={summary.byCategory.map((row) => ({
              name: row.category,
              total: row.total,
            }))}
          />
          <BreakdownTable
            caption="Department"
            currency={settings.currency}
            rows={summary.byDepartment.map((row) => ({
              name: row.name,
              total: row.total,
            }))}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Monthly trend</h2>
          {hasTrend ? (
            <TrendChart points={trends} currency={settings.currency} />
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              No approved spending in the last 6 months.
            </p>
          )}
          <p className="text-xs text-neutral-500">
            Approved expenses, last 6 months.
          </p>
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Spending by category</h2>
          {hasCategoryData ? (
            <CategoryChart
              data={summary.byCategory}
              currency={settings.currency}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              No approved spending in {month}.
            </p>
          )}
          <p className="text-xs text-neutral-500">
            Approved expenses in {month}.
          </p>
        </div>
      </section>
    </div>
  )
}
