import { formatAmount, formatPercent } from '@/lib/format'
import type { BudgetVsActualRow } from '@/services/report-service'

// Rule 6 thresholds are reflected here only as colours; the values themselves
// come from the service via lib/budget-status.ts (or the organization's own
// warning threshold since Phase 7C).
const STATUS_STYLES: Record<BudgetVsActualRow['status'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  exceeded:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  unbudgeted:
    'border-dashed border-neutral-300 bg-transparent text-neutral-600 dark:border-neutral-600 dark:text-neutral-300',
}

const STATUS_LABEL: Record<BudgetVsActualRow['status'], string> = {
  ok: 'OK',
  warning: 'Warning',
  exceeded: 'Exceeded',
  unbudgeted: 'No budget',
}

export function BudgetStatusBadge({
  status,
}: {
  status: BudgetVsActualRow['status']
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

// Server-rendered budget vs actual table. The column set adapts to the
// audience: admins see every department, everyone sees the awaiting-approval
// column because pending expenses never count toward spending (rule 5).
// Unbudgeted rows (approved spending without a budget) show dashes for the
// budget figures (Phase 7C).
export function BudgetVsActualTable({
  rows,
  currency,
  showDepartment = false,
  emptyMessage = 'No budgets for this month yet.',
}: {
  rows: BudgetVsActualRow[]
  currency: string
  showDepartment?: boolean
  emptyMessage?: string
}) {
  const colSpan = (showDepartment ? 1 : 0) + 9

  const money = (value: number | null) =>
    value === null ? '—' : formatAmount(value, currency)

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
          <tr>
            {showDepartment && (
              <th scope="col" className="px-4 py-3">
                Department
              </th>
            )}
            <th scope="col" className="px-4 py-3">
              Category
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Budget
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Carried over
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Available
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Spent
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Remaining
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Used
            </th>
            <th scope="col" className="px-4 py-3">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Awaiting
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-10 text-center text-neutral-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={`${row.departmentId}-${row.category}`}
                className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
              >
                {showDepartment && (
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-300">
                    {row.departmentName}
                  </td>
                )}
                <td className="px-4 py-3">{row.category}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {money(row.budget)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {row.carriedOver
                    ? formatAmount(row.carriedOver, currency)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {money(row.available)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {formatAmount(row.spent, currency)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {money(row.remaining)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {row.percentUsed === null
                    ? '—'
                    : formatPercent(row.percentUsed)}
                </td>
                <td className="px-4 py-3">
                  <BudgetStatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {formatAmount(row.awaitingApproval, currency)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
