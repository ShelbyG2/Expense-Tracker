import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { connectDB } from '@/lib/db'
import { User } from '@/models/user'
import { budgetAlerts, budgetVsActual } from '@/services/report-service'
import { getOrganizationSettings } from '@/services/organization-service'
import { currentMonth, formatAmount, formatPercent } from '@/lib/format'
import {
  BudgetStatusBadge,
  BudgetVsActualTable,
} from '@/components/budget-vs-actual-table'

// Dashboard content changes by role.
// Reads the session cookie on every request — blocking route (cacheComponents).
export const instant = false

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  await connectDB()
  const user = await User.findOne({
    _id: session.userId,
    organizationId: session.organizationId,
  }).lean()

  const month = currentMonth()
  // Managers get the alert list (Phase 4 output c); staff get a read-only
  // view of their own department's budget status (roles section).
  const [alerts, budgetRows, settings] = await Promise.all([
    session.role === 'manager' ? budgetAlerts(session, month) : [],
    session.role === 'staff' ? budgetVsActual(session, month) : [],
    getOrganizationSettings(session),
  ])
  const currency = settings.currency
  const hasExceeded = alerts.some((row) => row.status === 'exceeded')

  const greeting = user?.name ? `Welcome, ${user.name}` : 'Welcome'

  const blurb: Record<string, string> = {
    admin:
      'You manage users and departments and can see everything in your organization.',
    manager:
      'You set budgets, approve expenses for your department, and view reports.',
    staff:
      'You record your expenses and can view your department’s budget status.',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="mt-1 text-neutral-500">
          {blurb[session.role] ?? 'You are signed in.'}
        </p>
      </div>

      {alerts.length > 0 && (
        <section
          aria-label="Budget alerts"
          className={`rounded-lg border p-4 ${
            hasExceeded
              ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          }`}
        >
          <p className="text-sm font-semibold">
            {alerts.length === 1
              ? '1 category needs attention in '
              : `${alerts.length} categories need attention in `}
            {month}.
          </p>
          <ul className="mt-3 space-y-2">
            {alerts.map((row) => (
              <li
                key={`${row.departmentId}-${row.category}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <BudgetStatusBadge status={row.status} />
                <span className="font-medium">{row.category}</span>
                <span className="tabular-nums">
                  {row.percentUsed === null
                    ? `${formatAmount(row.spent, currency)} spent with no budget`
                    : `${formatPercent(row.percentUsed)} used (${formatAmount(row.spent, currency)} of ${formatAmount(row.available ?? 0, currency)})`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/budgets" className="underline">
              Adjust budgets
            </Link>
            {' · '}
            <Link href="/reports" className="underline">
              View reports
            </Link>
          </p>
        </section>
      )}

      {session.role === 'staff' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">
              Department budget status — {month}
            </h2>
            <p className="text-sm text-neutral-500">
              Read-only. Only approved expenses count; pending ones show as
              awaiting approval.
            </p>
          </div>
          <BudgetVsActualTable
            rows={budgetRows}
            currency={currency}
            emptyMessage={`No budgets for ${month} yet.`}
          />
        </section>
      )}

      <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">Role</dt>
            <dd className="font-medium capitalize">{session.role}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Organization</dt>
            <dd className="font-medium">{session.organizationId}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Department</dt>
            <dd className="font-medium">{session.departmentId ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
