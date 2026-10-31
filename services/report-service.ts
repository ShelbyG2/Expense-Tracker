// Report processing (Phase 4) — the MIS core: aggregation pipelines for the
// summary report, budget vs actual, monthly trends and budget alerts.
//
// All figures are computed in MongoDB, never in the UI, and every pipeline is
// filtered by the session's organizationId (rule 1) plus the per-role
// department scope from reportScope. Only approved expenses count toward
// spending totals; pending ones are reported separately as "awaiting
// approval" (rule 5). Status thresholds live in lib/budget-status.ts (rule 6).

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import type { Session } from '@/lib/auth'
import { reportScope } from '@/services/report-scope'
import { Expense } from '@/models/expense'
import { Budget, type IBudget } from '@/models/budget'
import { Department } from '@/models/department'
import { Organization } from '@/models/organization'
import { CATEGORIES, type Category } from '@/lib/constants'
import {
  BUDGET_THRESHOLDS,
  budgetStatus,
  percentUsed,
  type BudgetStatus,
  type BudgetThresholds,
} from '@/lib/budget-status'
import { currentMonth, previousMonth } from '@/lib/format'

export type CategoryTotal = { category: Category; total: number }

export type DepartmentTotal = {
  departmentId: string | null
  name: string
  total: number
}

export type SummaryReport = {
  month: string
  totalApproved: number
  awaitingApproval: number
  byCategory: CategoryTotal[]
  byDepartment: DepartmentTotal[]
}

export type BudgetVsActualRow = {
  departmentId: string
  departmentName: string
  category: Category
  // `null` for an unbudgeted row: approved spending in a category that has no
  // budget that month (Phase 7C).
  budget: number | null
  // Unspent amount carried in from the previous month (carryOver budgets).
  carriedOver: number
  // budget + carriedOver; null when there is no budget at all.
  available: number | null
  spent: number
  remaining: number | null
  // Ratio used (0.85 = 85% of the available amount); null when unbudgeted.
  percentUsed: number | null
  status: BudgetStatus
  awaitingApproval: number
}

export type TrendPoint = { month: string; total: number }

// `month` is `YYYY-MM` (validated by the callers' schemas). Expenses are
// stored at UTC midnight, so the range is the UTC calendar month.
function monthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 1)),
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Aggregation pipelines don't go through Mongoose's schema casting, so ids
// must become real ObjectIds before they reach $match.
function matchScope(session: Session): Record<string, unknown> {
  const scope = reportScope(session)
  if (scope.departmentId === undefined) return {}
  if (typeof scope.departmentId === 'string') {
    return { departmentId: new mongoose.Types.ObjectId(scope.departmentId) }
  }
  // `{ $in: [] }` — a user with no department matches nothing.
  return { departmentId: scope.departmentId }
}

function orgMatch(session: Session): Record<string, unknown> {
  return { organizationId: new mongoose.Types.ObjectId(session.organizationId) }
}

type SummaryFacet = {
  byCategory: { _id: Category; total: number }[]
  byDepartment: { _id: mongoose.Types.ObjectId | null; total: number }[]
  pending: { _id: null; total: number }[]
}

// a) Summary report: approved spending for a month, split by category and
// department, plus the pending total shown separately.
export async function summaryReport(
  session: Session,
  month: string,
): Promise<SummaryReport> {
  await connectDB()

  const { start, end } = monthRange(month)

  const [facet] = await Expense.aggregate<SummaryFacet>([
    {
      $match: {
        ...orgMatch(session),
        ...matchScope(session),
        date: { $gte: start, $lt: end },
      },
    },
    {
      $facet: {
        byCategory: [
          { $match: { status: 'approved' } },
          { $group: { _id: '$category', total: { $sum: '$amount' } } },
        ],
        byDepartment: [
          { $match: { status: 'approved' } },
          { $group: { _id: '$departmentId', total: { $sum: '$amount' } } },
        ],
        pending: [
          { $match: { status: 'pending' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
      },
    },
  ])

  // Fixed category order, zero-filled so rows line up with the charts.
  const categoryTotals = new Map(
    (facet?.byCategory ?? []).map((row) => [row._id, row.total]),
  )
  const byCategory: CategoryTotal[] = CATEGORIES.map((category) => ({
    category,
    total: round2(categoryTotals.get(category) ?? 0),
  }))

  const departmentTotals = new Map(
    (facet?.byDepartment ?? []).map((row) => [
      row._id ? String(row._id) : null,
      row.total,
    ]),
  )
  const scope = reportScope(session)
  // The scope keys on `departmentId`; the Department collection's own key is
  // `_id`, so map the scope across before the lookup.
  const departments = await Department.find({
    organizationId: session.organizationId,
    ...(scope.departmentId !== undefined ? { _id: scope.departmentId } : {}),
  })
    .select('name')
    .sort({ name: 1 })
    .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>()

  const byDepartment: DepartmentTotal[] = departments.map((dept) => ({
    departmentId: String(dept._id),
    name: dept.name,
    total: round2(departmentTotals.get(String(dept._id)) ?? 0),
  }))
  // Expenses authored by users without a department.
  const unassigned = departmentTotals.get(null)
  if (unassigned !== undefined) {
    byDepartment.push({
      departmentId: null,
      name: 'Unassigned',
      total: round2(unassigned),
    })
  }

  const totalApproved = round2(
    byCategory.reduce((sum, row) => sum + row.total, 0),
  )
  const awaitingApproval = round2(facet?.pending?.[0]?.total ?? 0)

  return { month, totalApproved, awaitingApproval, byCategory, byDepartment }
}

type SpendRow = {
  _id: {
    departmentId: mongoose.Types.ObjectId | null
    category: Category
    status: 'approved' | 'pending'
  }
  total: number
}

// Approved + pending spend for a month, keyed `departmentId|category|status`.
async function spendTotals(
  session: Session,
  month: string,
): Promise<Map<string, number>> {
  const { start, end } = monthRange(month)

  const spend = await Expense.aggregate<SpendRow>([
    {
      $match: {
        ...orgMatch(session),
        ...matchScope(session),
        date: { $gte: start, $lt: end },
        status: { $in: ['approved', 'pending'] },
      },
    },
    {
      $group: {
        _id: {
          departmentId: '$departmentId',
          category: '$category',
          status: '$status',
        },
        total: { $sum: '$amount' },
      },
    },
  ])

  const totals = new Map<string, number>()
  for (const row of spend) {
    const key = `${row._id.departmentId ?? ''}|${row._id.category}|${row._id.status}`
    totals.set(key, (totals.get(key) ?? 0) + row.total)
  }
  return totals
}

function departmentCategoryKey(
  departmentId: string,
  category: Category,
): string {
  return `${departmentId}|${category}`
}

// Rollover (Phase 7C): for budgets that opted in, the unspent approved amount
// of the previous month's budget for the same department + category. One level
// only — the previous month's own carried amount is not chained. Clamped at
// zero, so an overspent month carries nothing.
async function carriedOverByKey(
  session: Session,
  month: string,
  budgets: IBudget[],
): Promise<Map<string, number>> {
  const carried = new Map<string, number>()
  if (!budgets.some((budget) => budget.carryOver)) return carried

  const previous = previousMonth(month)
  const [previousBudgets, previousSpend] = await Promise.all([
    Budget.find({
      organizationId: session.organizationId,
      ...reportScope(session),
      month: previous,
    }).lean<IBudget[]>(),
    spendTotals(session, previous),
  ])

  const previousAmounts = new Map(
    previousBudgets.map((budget) => [
      departmentCategoryKey(String(budget.departmentId), budget.category),
      budget.amount,
    ]),
  )

  for (const budget of budgets) {
    if (!budget.carryOver) continue
    const key = departmentCategoryKey(
      String(budget.departmentId),
      budget.category,
    )
    const previousAmount = previousAmounts.get(key)
    if (previousAmount === undefined) continue
    const previousSpent = round2(previousSpend.get(`${key}|approved`) ?? 0)
    carried.set(key, round2(Math.max(0, previousAmount - previousSpent)))
  }

  return carried
}

// b) Budget vs actual: one row per budget with spent, remaining, percent
// used and status, plus an "unbudgeted" row for every department/category with
// approved spending but no budget that month (Phase 7C). Only approved
// expenses count as spent (rule 5).
export async function budgetVsActual(
  session: Session,
  month: string,
): Promise<BudgetVsActualRow[]> {
  await connectDB()

  const [budgets, org] = await Promise.all([
    Budget.find({
      organizationId: session.organizationId,
      ...reportScope(session),
      month,
    }).lean<IBudget[]>(),
    // The warning line is per-organization (Phase 7C); 100% is always exceeded.
    Organization.findOne({ _id: session.organizationId })
      .select('warningThreshold')
      .lean<{ warningThreshold?: number } | null>(),
  ])

  const thresholds: BudgetThresholds = {
    warning: org?.warningThreshold ?? BUDGET_THRESHOLDS.warning,
    exceeded: BUDGET_THRESHOLDS.exceeded,
  }

  const totals = await spendTotals(session, month)
  const carriedOver = await carriedOverByKey(session, month, budgets)

  const budgetKeys = new Set(
    budgets.map((budget) =>
      departmentCategoryKey(String(budget.departmentId), budget.category),
    ),
  )

  // Approved spending with no budget: department-less spending is skipped (a
  // budget always belongs to a department).
  const unbudgeted: { departmentId: string; category: Category }[] = []
  for (const key of totals.keys()) {
    const [departmentId, category, status] = key.split('|')
    if (status !== 'approved' || !departmentId || !category) continue
    if (budgetKeys.has(`${departmentId}|${category}`)) continue
    unbudgeted.push({ departmentId, category: category as Category })
  }

  const names = await departmentNamesByIds(session, [
    ...budgets.map((budget) => String(budget.departmentId)),
    ...unbudgeted.map((row) => row.departmentId),
  ])

  const rows: BudgetVsActualRow[] = budgets.map((budget) => {
    const departmentId = String(budget.departmentId)
    const key = departmentCategoryKey(departmentId, budget.category)
    const spent = round2(totals.get(`${key}|approved`) ?? 0)
    const awaiting = round2(totals.get(`${key}|pending`) ?? 0)
    const carried = carriedOver.get(key) ?? 0
    const available = round2(budget.amount + carried)
    const ratio = percentUsed(spent, available)
    return {
      departmentId,
      departmentName: names[departmentId] ?? 'Unknown department',
      category: budget.category,
      budget: budget.amount,
      carriedOver: carried,
      available,
      spent,
      remaining: round2(available - spent),
      percentUsed: ratio,
      status: budgetStatus(ratio, thresholds),
      awaitingApproval: awaiting,
    }
  })

  for (const row of unbudgeted) {
    const key = departmentCategoryKey(row.departmentId, row.category)
    rows.push({
      departmentId: row.departmentId,
      departmentName: names[row.departmentId] ?? 'Unknown department',
      category: row.category,
      budget: null,
      carriedOver: 0,
      available: null,
      spent: round2(totals.get(`${key}|approved`) ?? 0),
      remaining: null,
      percentUsed: null,
      status: 'unbudgeted',
      awaitingApproval: round2(totals.get(`${key}|pending`) ?? 0),
    })
  }

  // Stable, readable order: department name, then the fixed category order.
  return rows.sort(
    (a, b) =>
      a.departmentName.localeCompare(b.departmentName) ||
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category),
  )
}

// Alerts order: exceeded first, then warnings, then unbudgeted rows (which have
// no percentage to rank by). Ties fall back to the larger spend.
const ALERT_RANK: Record<BudgetStatus, number> = {
  exceeded: 0,
  warning: 1,
  unbudgeted: 2,
  ok: 3,
}

// c) Alerts: the rows that need attention, worst first.
export async function budgetAlerts(
  session: Session,
  month: string = currentMonth(),
): Promise<BudgetVsActualRow[]> {
  const rows = await budgetVsActual(session, month)
  return rows
    .filter((row) => row.status !== 'ok')
    .sort(
      (a, b) =>
        ALERT_RANK[a.status] - ALERT_RANK[b.status] ||
        (b.percentUsed ?? 0) - (a.percentUsed ?? 0) ||
        b.spent - a.spent,
    )
}

// d) Trends: approved spending per month for the last `months` months,
// zero-filled so the line chart has a point for every month.
export async function spendingTrends(
  session: Session,
  months = 6,
): Promise<TrendPoint[]> {
  await connectDB()

  const anchor = currentMonth()
  const [year, mon] = anchor.split('-').map(Number)
  const labels: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    labels.push(
      new Date(Date.UTC(year, mon - 1 - i, 1)).toISOString().slice(0, 7),
    )
  }

  const { start } = monthRange(labels[0])
  const { end } = monthRange(labels[labels.length - 1])

  const spend = await Expense.aggregate<{ _id: string; total: number }>([
    {
      $match: {
        ...orgMatch(session),
        ...matchScope(session),
        status: 'approved',
        date: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
        total: { $sum: '$amount' },
      },
    },
  ])

  const totals = new Map(spend.map((row) => [row._id, row.total]))
  return labels.map((month) => ({
    month,
    total: round2(totals.get(month) ?? 0),
  }))
}

async function departmentNamesByIds(
  session: Session,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id))
  if (unique.length === 0) return {}

  const docs = await Department.find({
    organizationId: session.organizationId,
    _id: { $in: unique },
  })
    .select('name')
    .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>()

  return Object.fromEntries(docs.map((doc) => [String(doc._id), doc.name]))
}
