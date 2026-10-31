// In-app notifications (Phase 7E). Created in services so the triggers stay in
// the mutation paths — never in components — and every notification is scoped
// to one recipient's organization and user id.
//
// Producers:
//   - an expense awaiting review  -> the reviewers of the submitter (staff
//     expenses: that department's managers, manager expenses: the org admins),
//   - an expense approved/rejected -> the submitter,
//   - an approved expense pushing a budget across the warning or exceeded line
//     -> the budget department's managers, once per budget and threshold
//     (dedupe key + unique partial index).
//
// The audience rules live in lib/notification-targets.ts so they stay testable
// without a database.

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import type { Session } from '@/lib/auth'
import { formatAmount } from '@/lib/format'
import {
  BUDGET_THRESHOLDS,
  budgetStatus,
  percentUsed,
  type BudgetThresholds,
} from '@/lib/budget-status'
import {
  audienceForBudgetThreshold,
  audienceForNewExpense,
  dedupeKeyForBudgetNotification,
  type NotificationAudience,
} from '@/lib/notification-targets'
import { currencyOf, warningThresholdOf } from '@/services/organization-service'
import { Budget, type IBudget } from '@/models/budget'
import { Expense } from '@/models/expense'
import {
  Notification,
  type NotificationType,
  type INotification,
} from '@/models/notification'
import { Organization } from '@/models/organization'
import { User } from '@/models/user'

const PAGE_SIZE_MAX = 50

export type NotificationView = {
  id: string
  type: NotificationType
  message: string
  link: string
  readAt: string | null
  createdAt: string
}

export type NotificationQuery = {
  page: number
  pageSize: number
}

export type NotificationListResult = {
  items: NotificationView[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  // Unread total for the caller, so the bell can refresh its badge from the
  // server instead of guessing.
  unreadCount: number
}

function normalizeQuery(raw: NotificationQuery): NotificationQuery {
  return {
    page: Math.max(1, raw.page),
    pageSize: Math.min(PAGE_SIZE_MAX, Math.max(1, raw.pageSize)),
  }
}

// UTC calendar month, matching how expenses and reports bucket months.
function monthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 1)),
  }
}

// ------------------------------------------------------------------ list

// The inbox of the caller. Every query is scoped to their own organization and
// user id, so no notification can leak between users (rule 1).
export async function listNotifications(
  session: Session,
  query: NotificationQuery,
): Promise<NotificationListResult> {
  await connectDB()

  const querySafe = normalizeQuery(query)
  const filter: Record<string, unknown> = {
    organizationId: session.organizationId,
    userId: session.userId,
  }

  const [total, unreadCount, docs] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, readAt: null }),
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((querySafe.page - 1) * querySafe.pageSize)
      .limit(querySafe.pageSize)
      .lean<INotification[]>(),
  ])

  return {
    page: querySafe.page,
    pageSize: querySafe.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / querySafe.pageSize)),
    unreadCount,
    items: docs.map((doc) => ({
      id: String(doc._id),
      type: doc.type,
      message: doc.message,
      link: doc.link,
      readAt: doc.readAt ? doc.readAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
    })),
  }
}

// ------------------------------------------------------------------ mark read

export async function markNotificationsRead(
  session: Session,
  body: { ids?: string[]; all?: boolean } = {},
): Promise<{ updatedCount: number }> {
  await connectDB()

  const filter: Record<string, unknown> = {
    organizationId: session.organizationId,
    userId: session.userId,
  }

  if (body.all) {
    filter.readAt = null
  } else if (body.ids && body.ids.length > 0) {
    for (const id of body.ids) {
      if (!mongoose.isValidObjectId(id)) {
        throw httpError(400, 'Invalid notification id')
      }
    }
    filter._id = { $in: body.ids }
  } else {
    return { updatedCount: 0 }
  }

  const result = await Notification.updateMany(filter, {
    $set: { readAt: new Date() },
  })
  return { updatedCount: result.modifiedCount }
}

// ------------------------------------------------------------------ helpers

// Recipients for an audience: the department's active managers, or the
// organization's active admins when the audience has no department.
async function recipientsFor(
  audience: NotificationAudience | null,
  excludeUserId?: string,
): Promise<string[]> {
  if (!audience) return []

  const filter: Record<string, unknown> = {
    organizationId: audience.organizationId,
    isActive: true,
    role: audience.departmentId ? 'manager' : 'admin',
  }
  if (audience.departmentId) filter.departmentId = audience.departmentId
  if (excludeUserId) filter._id = { $ne: excludeUserId }

  const users = await User.find(filter).select('_id').lean<{ _id: unknown }[]>()

  return users.map((user) => String(user._id))
}

async function currencyFor(organizationId: string): Promise<string> {
  const org = await Organization.findById(organizationId)
    .select('currency')
    .lean<{ currency?: string | null } | null>()
  return currencyOf(org ?? {})
}

async function emit({
  userId,
  organizationId,
  type,
  message,
  link,
  dedupeKey,
}: {
  userId: string
  organizationId: string
  type: NotificationType
  message: string
  link: string
  dedupeKey?: string | null
}): Promise<void> {
  await connectDB()
  try {
    await Notification.create({
      userId,
      organizationId,
      type,
      message,
      link,
      dedupeKey: dedupeKey ?? null,
    })
  } catch (err: unknown) {
    // The unique partial index on dedupeKey makes a repeated emission a no-op.
    if ((err as { code?: number }).code === 11000) return
    throw err
  }
}

async function emitTo(
  audience: NotificationAudience | null,
  payload: {
    type: NotificationType
    message: string
    link: string
    dedupeKey?: string | null
  },
  excludeUserId?: string,
): Promise<void> {
  const recipients = await recipientsFor(audience, excludeUserId)
  for (const userId of recipients) {
    await emit({
      userId,
      organizationId: audience!.organizationId,
      type: payload.type,
      message: payload.message,
      link: payload.link,
      dedupeKey: payload.dedupeKey,
    })
  }
}

type ExpenseNotificationInput = {
  _id: unknown
  organizationId: unknown
  userId: unknown
  departmentId: unknown
  submitterRole: 'staff' | 'manager'
  amount: number
  date: Date
}

// ------------------------------------------------------------------ review

// An expense was approved: tell the person who submitted it.
export async function notifyExpenseApproved(
  expense: ExpenseNotificationInput,
  link: string,
): Promise<void> {
  const currency = await currencyFor(String(expense.organizationId))
  await emit({
    userId: String(expense.userId),
    organizationId: String(expense.organizationId),
    type: 'expense_approved',
    message: `Your ${formatAmount(expense.amount, currency)} expense was approved.`,
    link,
    dedupeKey: `expense:${String(expense._id)}:approved`,
  })
}

// An expense was rejected: tell the person who submitted it.
export async function notifyExpenseRejected(
  expense: ExpenseNotificationInput,
  link: string,
): Promise<void> {
  const currency = await currencyFor(String(expense.organizationId))
  await emit({
    userId: String(expense.userId),
    organizationId: String(expense.organizationId),
    type: 'expense_rejected',
    message: `Your ${formatAmount(expense.amount, currency)} expense was rejected.`,
    link,
    dedupeKey: `expense:${String(expense._id)}:rejected`,
  })
}

// A new expense is waiting for a decision: tell its reviewers.
export async function notifyExpenseAwaitingReview(
  expense: ExpenseNotificationInput,
  link: string,
): Promise<void> {
  const audience = audienceForNewExpense({
    role: expense.submitterRole,
    departmentId: expense.departmentId ? String(expense.departmentId) : null,
    organizationId: String(expense.organizationId),
  })
  if (!audience) return

  const currency = await currencyFor(String(expense.organizationId))
  await emitTo(
    audience,
    {
      type: 'expense_pending',
      message: `A ${formatAmount(expense.amount, currency)} expense is awaiting review.`,
      link,
      dedupeKey: null,
    },
    String(expense.userId),
  )
}

// ------------------------------------------------------------------ budget crossing

type ApprovedExpenseInput = {
  _id: unknown
  organizationId: unknown
  departmentId: unknown
  category: string
  amount: number
  date: Date
}

// Called after an expense was approved. Computes spending before and after this
// approval, and notifies the budget department's managers only when the status
// moves into warning or exceeded — not on every approval.
export async function notifyBudgetCrossedAfterApproval(
  expense: ApprovedExpenseInput,
): Promise<void> {
  if (!expense.departmentId) return

  const organizationId = String(expense.organizationId)
  const departmentId = String(expense.departmentId)
  const month = expense.date.toISOString().slice(0, 7)
  const { start, end } = monthRange(month)

  await connectDB()

  const budget = await Budget.findOne({
    organizationId,
    departmentId,
    category: expense.category,
    month,
  }).lean<IBudget | null>()
  if (!budget) return

  // Approved spend excluding this expense is the "before" figure: the expense
  // was pending until this approval.
  const [row] = await Expense.aggregate<{ total: number }>([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        departmentId: new mongoose.Types.ObjectId(departmentId),
        category: expense.category,
        status: 'approved',
        _id: { $ne: new mongoose.Types.ObjectId(String(expense._id)) },
        date: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])

  const spentBefore = row?.total ?? 0
  const spentAfter = spentBefore + expense.amount

  const org = await Organization.findById(organizationId)
    .select('warningThreshold currency')
    .lean<{
      warningThreshold?: number | null
      currency?: string | null
    } | null>()
  const thresholds: BudgetThresholds = {
    warning: warningThresholdOf(org ?? {}),
    exceeded: BUDGET_THRESHOLDS.exceeded,
  }

  const before = budgetStatus(
    percentUsed(spentBefore, budget.amount),
    thresholds,
  )
  const after = budgetStatus(percentUsed(spentAfter, budget.amount), thresholds)

  // Nothing to say when the budget is still fine, or was already in this state
  // (the notification for that status was sent when it was first crossed).
  if (after === 'ok' || after === before) return

  const currency = currencyOf(org ?? {})
  const audience = audienceForBudgetThreshold({
    budgetDepartmentId: departmentId,
    organizationId,
  })

  await emitTo(audience, {
    type: after === 'exceeded' ? 'budget_exceeded' : 'budget_warning',
    message:
      `${expense.category} budget for ${month} is ${Math.round(percentUsed(spentAfter, budget.amount) * 100)}% used ` +
      `(${formatAmount(spentAfter, currency)} of ${formatAmount(budget.amount, currency)}).`,
    link: '/budgets',
    dedupeKey: dedupeKeyForBudgetNotification(budget._id, after),
  })
}
