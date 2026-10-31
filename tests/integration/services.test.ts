// Integration tests for the service layer against a real MongoDB
// (mongodb-memory-server). Unlike the unit tests, nothing is mocked: the
// aggregation pipelines, unique indexes and TTL/partial indexes are real.
//
// `lib/db.ts` reads MONGODB_URI when it is first imported, so the server is
// started before any service module is imported. Every import below
// `beforeAll` is dynamic on purpose.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Session } from '@/lib/auth'

let mongo: MongoMemoryServer

let db: typeof import('@/lib/db')
let expenseService: typeof import('@/services/expense-service')
let budgetService: typeof import('@/services/budget-service')
let reportService: typeof import('@/services/report-service')
let adminService: typeof import('@/services/admin-service')
let notificationService: typeof import('@/services/notification-service')
let rateLimit: typeof import('@/lib/rate-limit')
let format: typeof import('@/lib/format')

let Organization: typeof import('@/models/organization').Organization
let Department: typeof import('@/models/department').Department
let User: typeof import('@/models/user').User
let Budget: typeof import('@/models/budget').Budget
let Expense: typeof import('@/models/expense').Expense
let Notification: typeof import('@/models/notification').Notification
let AuditLog: typeof import('@/models/audit-log').AuditLog
let RateLimit: typeof import('@/models/rate-limit').RateLimit

let TODAY = ''
let THIS_MONTH = ''
let PREV_MONTH = ''

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()

  ;[
    db,
    expenseService,
    budgetService,
    reportService,
    adminService,
    notificationService,
  ] = await Promise.all([
    import('@/lib/db'),
    import('@/services/expense-service'),
    import('@/services/budget-service'),
    import('@/services/report-service'),
    import('@/services/admin-service'),
    import('@/services/notification-service'),
  ])
  rateLimit = await import('@/lib/rate-limit')
  format = await import('@/lib/format')
  ;({
    Organization,
    Department,
    User,
    Budget,
    Expense,
    Notification,
    AuditLog,
  } = await Promise.all([
    import('@/models/organization'),
    import('@/models/department'),
    import('@/models/user'),
    import('@/models/budget'),
    import('@/models/expense'),
    import('@/models/notification'),
    import('@/models/audit-log'),
  ]).then(([org, dept, user, budget, expense, notification, audit]) => ({
    Organization: org.Organization,
    Department: dept.Department,
    User: user.User,
    Budget: budget.Budget,
    Expense: expense.Expense,
    Notification: notification.Notification,
    AuditLog: audit.AuditLog,
  })))
  ;({ RateLimit } = await import('@/models/rate-limit'))

  await db.connectDB()
  // Real indexes are part of the behaviour under test (unique dedupe keys,
  // last-admin guards aside, the rate-limit upsert race).
  await Promise.all([
    Organization.syncIndexes(),
    Department.syncIndexes(),
    User.syncIndexes(),
    Budget.syncIndexes(),
    Expense.syncIndexes(),
    Notification.syncIndexes(),
    AuditLog.syncIndexes(),
    RateLimit.syncIndexes(),
  ])

  TODAY = format.todayDateOnly()
  THIS_MONTH = TODAY.slice(0, 7)
  PREV_MONTH = format.previousMonth(THIS_MONTH)
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongo?.stop()
})

beforeEach(async () => {
  // Each test gets an empty database; the organization ids are unique anyway.
  const collections = Object.values(mongoose.connection.collections)
  await Promise.all(collections.map((collection) => collection.deleteMany({})))
})

// ------------------------------------------------------------------ fixtures

function sessionFor(
  user: { _id: unknown; organizationId: unknown; departmentId: unknown },
  role: Session['role'],
): Session {
  return {
    userId: String(user._id),
    organizationId: String(user.organizationId),
    departmentId: user.departmentId ? String(user.departmentId) : null,
    role,
  }
}

async function makeUser(
  orgId: string,
  deptId: string | null,
  email: string,
  role: Session['role'],
) {
  return User.create({
    organizationId: orgId,
    departmentId: deptId,
    name: email,
    email,
    passwordHash: 'not-used-in-these-tests',
    role,
    isActive: true,
  })
}

async function seedWorkspace(label: string) {
  const org = await Organization.create({ name: `Integration ${label}` })
  const orgId = String(org._id)
  const deptA = await Department.create({
    organizationId: orgId,
    name: `Department A ${label}`,
  })
  const deptB = await Department.create({
    organizationId: orgId,
    name: `Department B ${label}`,
  })
  const deptAId = String(deptA._id)
  const deptBId = String(deptB._id)

  const admin = await makeUser(orgId, null, `admin-${label}@test.dev`, 'admin')
  const managerA = await makeUser(
    orgId,
    deptAId,
    `manager-a-${label}@test.dev`,
    'manager',
  )
  const managerB = await makeUser(
    orgId,
    deptBId,
    `manager-b-${label}@test.dev`,
    'manager',
  )
  const staffA = await makeUser(
    orgId,
    deptAId,
    `staff-a-${label}@test.dev`,
    'staff',
  )
  const staffB = await makeUser(
    orgId,
    deptBId,
    `staff-b-${label}@test.dev`,
    'staff',
  )

  return {
    org,
    orgId,
    deptA,
    deptB,
    deptAId,
    deptBId,
    admin,
    managerA,
    managerB,
    staffA,
    staffB,
    adminSession: sessionFor(admin, 'admin'),
    managerASession: sessionFor(managerA, 'manager'),
    managerBSession: sessionFor(managerB, 'manager'),
    staffASession: sessionFor(staffA, 'staff'),
    staffBSession: sessionFor(staffB, 'staff'),
  }
}

function expenseInput(overrides?: {
  category?: 'Transport' | 'Meals' | 'Supplies'
  amount?: number
}) {
  return {
    category: overrides?.category ?? ('Transport' as const),
    amount: overrides?.amount ?? 100,
    date: new Date(TODAY),
    description: 'integration test expense',
  }
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toMatchObject({ status })
}

async function inboxOf(session: Session) {
  return notificationService.listNotifications(session, {
    page: 1,
    pageSize: 50,
  })
}

// ------------------------------------------------------------------ expenses

describe('expense service (real MongoDB)', () => {
  it('derives owner, department and submitterRole from the session', async () => {
    const w = await seedWorkspace('expense-create')

    const expense = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )

    expect(expense.userId).toBe(String(w.staffA._id))
    expect(expense.departmentId).toBe(w.deptAId)
    expect(expense.submitterRole).toBe('staff')
    expect(expense.status).toBe('pending')
    expect(expense.organizationId).toBe(w.orgId)

    const audits = await AuditLog.find({
      organizationId: w.orgId,
      entityId: expense.id,
    }).lean()
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe('create')

    // Reviewers are notified by the service, not by the route.
    const managerInbox = await inboxOf(w.managerASession)
    expect(managerInbox.items.some((n) => n.type === 'expense_pending')).toBe(
      true,
    )
    const otherManagerInbox = await inboxOf(w.managerBSession)
    expect(otherManagerInbox.items).toHaveLength(0)
  })

  it('scopes lists by role with real queries', async () => {
    const w = await seedWorkspace('expense-scope')

    await expenseService.createExpense(w.staffASession, expenseInput())
    await expenseService.createExpense(w.staffBSession, expenseInput())
    await expenseService.createExpense(w.managerASession, expenseInput())

    const query = {
      page: 1,
      pageSize: 20,
      sortBy: 'date' as const,
      sortDir: 'desc' as const,
    }

    const staffList = await expenseService.listExpenses(w.staffASession, query)
    expect(staffList.total).toBe(1)
    expect(staffList.items[0].userId).toBe(String(w.staffA._id))

    const managerList = await expenseService.listExpenses(
      w.managerASession,
      query,
    )
    // Department A: one staff expense plus the manager's own.
    expect(managerList.total).toBe(2)
    expect(managerList.items.every((e) => e.departmentId === w.deptAId)).toBe(
      true,
    )

    const adminList = await expenseService.listExpenses(w.adminSession, query)
    expect(adminList.total).toBe(3)
  })

  it('lets the right reviewer decide, and never the submitter', async () => {
    const w = await seedWorkspace('expense-review')

    const staffExpense = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )
    const managerExpense = await expenseService.createExpense(
      w.managerASession,
      expenseInput(),
    )
    const otherDeptExpense = await expenseService.createExpense(
      w.staffBSession,
      expenseInput(),
    )

    // The submitter (even a manager) cannot review their own expense.
    await expectStatus(
      expenseService.reviewExpense(w.managerASession, managerExpense.id, {
        action: 'approve',
      }),
      404,
    )

    // A manager reviews staff expenses in their own department only.
    await expectStatus(
      expenseService.reviewExpense(w.managerASession, otherDeptExpense.id, {
        action: 'approve',
      }),
      404,
    )

    const approved = await expenseService.reviewExpense(
      w.managerASession,
      staffExpense.id,
      { action: 'approve', reason: 'Looks good' },
    )
    expect(approved.status).toBe('approved')
    expect(approved.reviewedBy).toBe(String(w.managerA._id))
    expect(approved.reviewNote).toBe('Looks good')

    // An admin reviews manager expenses, not staff ones.
    await expectStatus(
      expenseService.reviewExpense(w.adminSession, staffExpense.id, {
        action: 'approve',
      }),
      404,
    )
    const adminApproved = await expenseService.reviewExpense(
      w.adminSession,
      managerExpense.id,
      { action: 'approve' },
    )
    expect(adminApproved.status).toBe('approved')

    // Reviewing twice is a conflict, not a silent overwrite.
    await expectStatus(
      expenseService.reviewExpense(w.managerASession, staffExpense.id, {
        action: 'reject',
      }),
      409,
    )

    const audits = await AuditLog.find({
      organizationId: w.orgId,
      action: 'approve',
    }).lean()
    expect(audits).toHaveLength(2)

    const staffInbox = await inboxOf(w.staffASession)
    expect(staffInbox.items.some((n) => n.type === 'expense_approved')).toBe(
      true,
    )
  })

  it('stores a rejection note and notifies the submitter', async () => {
    const w = await seedWorkspace('expense-reject')
    const expense = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )

    const rejected = await expenseService.reviewExpense(
      w.managerASession,
      expense.id,
      { action: 'reject', reason: 'Missing receipt' },
    )
    expect(rejected.status).toBe('rejected')
    expect(rejected.reviewNote).toBe('Missing receipt')

    const staffInbox = await inboxOf(w.staffASession)
    const notice = staffInbox.items.find((n) => n.type === 'expense_rejected')
    expect(notice?.link).toBe('/expenses')
  })

  it('only lets the owner delete, and only while pending', async () => {
    const w = await seedWorkspace('expense-delete')
    const expense = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )

    // Out of scope looks like "not found"; in-scope but not the owner is 403.
    await expectStatus(
      expenseService.deleteExpense(w.staffBSession, expense.id),
      404,
    )
    await expectStatus(
      expenseService.deleteExpense(w.managerASession, expense.id),
      403,
    )

    await expenseService.deleteExpense(w.staffASession, expense.id)
    expect(await Expense.countDocuments({ _id: expense.id })).toBe(0)
  })
})

// ------------------------------------------------------------------ budgets

describe('budget service (real MongoDB)', () => {
  it('creates only for the manager’s own department and refuses duplicates', async () => {
    const w = await seedWorkspace('budget-create')

    const budget = await budgetService.createBudget(w.managerASession, {
      category: 'Transport',
      amount: 1000,
      month: THIS_MONTH,
    })
    expect(budget.departmentId).toBe(w.deptAId)
    expect(budget.carryOver).toBe(false)

    await expectStatus(
      budgetService.createBudget(w.managerASession, {
        category: 'Transport',
        amount: 2000,
        month: THIS_MONTH,
      }),
      409,
    )
    await expectStatus(
      budgetService.createBudget(w.adminSession, {
        category: 'Supplies',
        amount: 500,
        month: THIS_MONTH,
      }),
      403,
    )
  })

  it('lists budgets within the caller’s scope', async () => {
    const w = await seedWorkspace('budget-scope')
    await budgetService.createBudget(w.managerASession, {
      category: 'Transport',
      amount: 1000,
      month: THIS_MONTH,
    })
    await budgetService.createBudget(w.managerBSession, {
      category: 'Meals',
      amount: 400,
      month: THIS_MONTH,
    })

    const own = await budgetService.listBudgets(w.managerASession, {})
    expect(own.total).toBe(1)
    expect(own.items[0].departmentId).toBe(w.deptAId)

    const all = await budgetService.listBudgets(w.adminSession, {})
    expect(all.total).toBe(2)
  })

  it('copies a month, skipping categories that already exist', async () => {
    const w = await seedWorkspace('budget-copy')
    await budgetService.createBudget(w.managerASession, {
      category: 'Transport',
      amount: 1000,
      month: THIS_MONTH,
    })
    await budgetService.createBudget(w.managerASession, {
      category: 'Meals',
      amount: 500,
      month: THIS_MONTH,
    })
    // Target month already has Meals.
    await budgetService.createBudget(w.managerASession, {
      category: 'Meals',
      amount: 200,
      month: PREV_MONTH,
    })

    const result = await budgetService.copyBudgets(w.managerASession, {
      fromMonth: THIS_MONTH,
      toMonth: PREV_MONTH,
    })
    expect(result).toEqual({ month: PREV_MONTH, created: 1, skipped: 1 })

    const target = await budgetService.listBudgets(w.managerASession, {
      month: PREV_MONTH,
    })
    const meals = target.items.find((b) => b.category === 'Meals')
    expect(meals?.amount).toBe(200) // not overwritten

    // Three manual creates plus the one copied budget (the skipped category is
    // not audited).
    const budgetCreates = await AuditLog.find({
      organizationId: w.orgId,
      entity: 'Budget',
      action: 'create',
    }).lean()
    expect(budgetCreates).toHaveLength(4)
  })
})

// ------------------------------------------------------------------ reports

describe('report service (real aggregation pipelines)', () => {
  it('aggregates approved spend, pending totals and budget statuses', async () => {
    const w = await seedWorkspace('reports')

    await budgetService.createBudget(w.managerASession, {
      category: 'Transport',
      amount: 1000,
      month: THIS_MONTH,
    })
    await budgetService.createBudget(w.managerASession, {
      category: 'Meals',
      amount: 500,
      month: THIS_MONTH,
    })

    const approved = async (
      session: Session,
      amount: number,
      category: 'Transport' | 'Meals' | 'Supplies',
      date = new Date(TODAY),
    ) =>
      Expense.create({
        organizationId: session.organizationId,
        departmentId: session.departmentId,
        userId: session.userId,
        submitterRole: 'staff',
        category,
        amount,
        date,
        description: 'report fixture',
        status: 'approved',
        reviewedBy: String(w.managerA._id),
        reviewedAt: new Date(),
      })

    await approved(w.staffASession, 850, 'Transport')
    await approved(w.staffASession, 250, 'Meals')
    await approved(w.staffBSession, 120, 'Supplies')
    await approved(
      w.staffASession,
      300,
      'Transport',
      new Date(`${PREV_MONTH}-05T00:00:00.000Z`),
    )
    // Pending money is reported separately and never counted as spent.
    await expenseService.createExpense(
      w.staffASession,
      expenseInput({ amount: 40 }),
    )

    const summary = await reportService.summaryReport(
      w.adminSession,
      THIS_MONTH,
    )
    expect(summary.totalApproved).toBe(1220)
    expect(summary.awaitingApproval).toBe(40)
    expect(
      Object.fromEntries(
        summary.byCategory.map((row) => [row.category, row.total]),
      ),
    ).toMatchObject({ Transport: 850, Meals: 250, Supplies: 120 })
    expect(
      Object.fromEntries(
        summary.byDepartment.map((row) => [row.departmentId, row.total]),
      ),
    ).toMatchObject({ [w.deptAId]: 1100, [w.deptBId]: 120 })

    const rows = await reportService.budgetVsActual(w.adminSession, THIS_MONTH)
    const transport = rows.find(
      (row) => row.departmentId === w.deptAId && row.category === 'Transport',
    )
    expect(transport?.budget).toBe(1000)
    expect(transport?.spent).toBe(850)
    expect(transport?.remaining).toBe(150)
    expect(transport?.percentUsed).toBeCloseTo(0.85, 5)
    expect(transport?.status).toBe('warning')
    expect(transport?.awaitingApproval).toBe(40)

    const meals = rows.find(
      (row) => row.departmentId === w.deptAId && row.category === 'Meals',
    )
    expect(meals?.status).toBe('ok')

    const unbudgeted = rows.find(
      (row) => row.departmentId === w.deptBId && row.category === 'Supplies',
    )
    expect(unbudgeted?.budget).toBeNull()
    expect(unbudgeted?.status).toBe('unbudgeted')
    expect(unbudgeted?.spent).toBe(120)

    const alerts = await reportService.budgetAlerts(w.adminSession, THIS_MONTH)
    expect(alerts.map((row) => row.status)).toEqual(['warning', 'unbudgeted'])

    const trends = await reportService.spendingTrends(w.adminSession, 6)
    expect(trends).toHaveLength(6)
    expect(trends[trends.length - 1]).toEqual({
      month: THIS_MONTH,
      total: 1220,
    })
    const previous = trends.find((point) => point.month === PREV_MONTH)
    expect(previous?.total).toBe(300)
  })
})

// ------------------------------------------------------------------ admin

describe('admin service (real MongoDB)', () => {
  it('creates users, refuses duplicates and keeps department counts', async () => {
    const w = await seedWorkspace('admin-users')

    const created = await adminService.createUser(w.adminSession, {
      name: 'New Staff',
      email: 'new-staff@test.dev',
      password: 'Password123!',
      role: 'staff',
      departmentId: w.deptAId,
    })
    expect(created.departmentId).toBe(w.deptAId)

    await expectStatus(
      adminService.createUser(w.adminSession, {
        name: 'Duplicate',
        email: 'NEW-STAFF@test.dev',
        password: 'Password123!',
        role: 'staff',
        departmentId: null,
      }),
      409,
    )

    const departments = await adminService.listDepartments(w.adminSession)
    const deptA = departments.find((d) => d.id === w.deptAId)
    expect(deptA?.userCount).toBe(3) // manager A, staff A, the new user
    expect(deptA?.isArchived).toBe(false)
  })

  it('archived departments block new users, budgets and expenses but keep history', async () => {
    const w = await seedWorkspace('admin-archive')

    const expense = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )
    const archived = await adminService.archiveDepartment(
      w.adminSession,
      w.deptAId,
    )
    expect(archived.isArchived).toBe(true)
    expect(archived.expenseCount).toBe(1)

    await expectStatus(
      adminService.createUser(w.adminSession, {
        name: 'Blocked',
        email: 'blocked-@test.dev',
        password: 'Password123!',
        role: 'staff',
        departmentId: w.deptAId,
      }),
      400,
    )
    await expectStatus(
      budgetService.createBudget(w.managerASession, {
        category: 'Transport',
        amount: 100,
        month: THIS_MONTH,
      }),
      400,
    )
    await expectStatus(
      expenseService.createExpense(w.staffASession, expenseInput()),
      400,
    )

    // History survives: the expense is still readable and counted.
    const stillThere = await expenseService.getExpense(
      w.staffASession,
      expense.id,
    )
    expect(stillThere?.id).toBe(expense.id)

    const unarchived = await adminService.unarchiveDepartment(
      w.adminSession,
      w.deptAId,
    )
    expect(unarchived.isArchived).toBe(false)
    const afterUnarchive = await expenseService.createExpense(
      w.staffASession,
      expenseInput(),
    )
    expect(afterUnarchive.status).toBe('pending')
  })

  it('refuses a hard delete while that department still has references', async () => {
    const w = await seedWorkspace('admin-delete')

    const dept = await Department.create({
      organizationId: w.orgId,
      name: 'Only Expenses',
    })
    await Expense.create({
      organizationId: w.orgId,
      departmentId: String(dept._id),
      userId: String(w.admin._id),
      submitterRole: 'staff',
      category: 'Other',
      amount: 10,
      date: new Date(TODAY),
      description: 'blocks delete',
      status: 'pending',
    })

    await expectStatus(
      adminService.deleteDepartment(w.adminSession, String(dept._id)),
      409,
    )

    await Expense.deleteMany({ departmentId: dept._id })
    await adminService.deleteDepartment(w.adminSession, String(dept._id))
    expect(await Department.countDocuments({ _id: dept._id })).toBe(0)
  })
})

// ------------------------------------------------------------------ notifications

describe('notification service (real MongoDB)', () => {
  it('sends one budget warning then one exceeded notice, never per expense', async () => {
    const w = await seedWorkspace('notification-budget')
    await budgetService.createBudget(w.managerASession, {
      category: 'Transport',
      amount: 1000,
      month: THIS_MONTH,
    })
    // Start at 70% without going through the review path.
    await Expense.create({
      organizationId: w.orgId,
      departmentId: w.deptAId,
      userId: String(w.staffA._id),
      submitterRole: 'staff',
      category: 'Transport',
      amount: 700,
      date: new Date(TODAY),
      description: 'seeded approved spend',
      status: 'approved',
      reviewedBy: String(w.managerA._id),
      reviewedAt: new Date(),
    })

    async function approve(amount: number) {
      const expense = await expenseService.createExpense(
        w.staffASession,
        expenseInput({ amount }),
      )
      await expenseService.reviewExpense(w.managerASession, expense.id, {
        action: 'approve',
      })
    }

    // 700 -> 850 = 85%: first crossing of the warning line.
    await approve(150)
    let inbox = await inboxOf(w.managerASession)
    expect(inbox.items.filter((n) => n.type === 'budget_warning')).toHaveLength(
      1,
    )

    // 850 -> 900: still in the warning band, so no second notice.
    await approve(50)
    inbox = await inboxOf(w.managerASession)
    expect(inbox.items.filter((n) => n.type === 'budget_warning')).toHaveLength(
      1,
    )

    // 900 -> 1050 = 105%: crossing into exceeded sends exactly one notice of
    // each kind.
    await approve(150)
    inbox = await inboxOf(w.managerASession)
    expect(inbox.items.filter((n) => n.type === 'budget_warning')).toHaveLength(
      1,
    )
    expect(
      inbox.items.filter((n) => n.type === 'budget_exceeded'),
    ).toHaveLength(1)

    // The dedupe key is stable, so the unique partial index holds one row.
    const budgetRows = await Notification.find({
      organizationId: w.orgId,
      type: 'budget_warning',
    }).lean()
    expect(budgetRows).toHaveLength(1)
    expect(budgetRows[0].dedupeKey).toMatch(/^budget:[0-9a-f]{24}:warning$/)

    // Another department's manager is never told.
    const otherInbox = await inboxOf(w.managerBSession)
    expect(
      otherInbox.items.filter((n) => n.type.startsWith('budget_')),
    ).toHaveLength(0)
  })

  it('scopes the inbox and mark-read to the caller', async () => {
    const w = await seedWorkspace('notification-scope')

    await expenseService.createExpense(w.staffASession, expenseInput())
    const staffInbox = await inboxOf(w.staffASession)
    const otherInbox = await inboxOf(w.staffBSession)

    expect(staffInbox.unreadCount).toBe(0) // pending notices went to managers
    expect(otherInbox.items).toHaveLength(0)

    const managerInbox = await inboxOf(w.managerASession)
    expect(managerInbox.unreadCount).toBe(1)
    const target = managerInbox.items[0]

    // A different user cannot touch that row.
    const foreign = await notificationService.markNotificationsRead(
      w.staffASession,
      { ids: [target.id] },
    )
    expect(foreign.updatedCount).toBe(0)

    const own = await notificationService.markNotificationsRead(
      w.managerASession,
      { ids: [target.id] },
    )
    expect(own.updatedCount).toBe(1)
    expect((await inboxOf(w.managerASession)).unreadCount).toBe(0)

    // A new expense re-fills the inbox; "all" clears it.
    await expenseService.createExpense(w.staffASession, expenseInput())
    expect((await inboxOf(w.managerASession)).unreadCount).toBe(1)
    const all = await notificationService.markNotificationsRead(
      w.managerASession,
      { all: true },
    )
    expect(all.updatedCount).toBe(1)
    expect((await inboxOf(w.managerASession)).unreadCount).toBe(0)

    // Validation: a malformed id is a 400 from the service itself.
    await expectStatus(
      notificationService.markNotificationsRead(w.managerASession, {
        ids: ['not-an-id'],
      }),
      400,
    )
  })
})

// ------------------------------------------------------------------ rate limit

describe('rate limiter (real MongoDB)', () => {
  it('allows five attempts per window, blocks the sixth and resets', async () => {
    const key = 'integration:rate-limit'

    const attempts: boolean[] = []
    for (let i = 0; i < 5; i++) {
      attempts.push(await rateLimit.checkRateLimit(key))
    }
    expect(attempts).toEqual([true, true, true, true, true])
    expect(await rateLimit.checkRateLimit(key)).toBe(false)

    // A different key is unaffected.
    expect(await rateLimit.checkRateLimit('integration:other')).toBe(true)

    await rateLimit.resetRateLimit(key)
    expect(await rateLimit.checkRateLimit(key)).toBe(true)
  })

  it('keeps one counter document per key and window', async () => {
    const key = 'integration:atomic'
    await Promise.all(
      Array.from({ length: 5 }, () => rateLimit.checkRateLimit(key)),
    )
    const rows = await RateLimit.find({ key }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(5)
  })
})
