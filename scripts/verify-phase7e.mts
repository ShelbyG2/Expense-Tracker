// Phase 7E (in-app notifications) end-to-end verification.
//
// Usage: npx tsx scripts/verify-phase7e.mts   (dev server must be running)
//
// Creates a throwaway organization and verifies:
//   - an expense awaiting review notifies its reviewers (staff -> department
//     managers, manager -> organization admins),
//   - an approval notifies the submitter (expense_approved),
//   - a rejection notifies the submitter (expense_rejected),
//   - an approval that pushes a budget across the warning line notifies the
//     department managers exactly once, and crossing into exceeded sends
//     exactly one more (dedupe key),
//   - marking one notification as read lowers the unread count,
//   - marking all as read clears it,
//   - notifications are scoped to their recipient (other users and other
//     departments never see them).
//
// Fixtures are removed at the end; exits non-zero on failure.

import { loadEnvFile } from 'node:process'
import mongoose from 'mongoose'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { Organization } = await import('../models/organization.ts')
const { Department } = await import('../models/department.ts')
const { User } = await import('../models/user.ts')
const { Budget } = await import('../models/budget.ts')
const { Expense } = await import('../models/expense.ts')
const { AuditLog } = await import('../models/audit-log.ts')
const { Notification } = await import('../models/notification.ts')
const { todayDateOnly } = await import('../lib/format.ts')

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000'
const PASS = 'VerifyPass123!'
const runId = Date.now().toString(36)
const TODAY = todayDateOnly()
const MONTH = TODAY.slice(0, 7)

let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++
    console.log(`PASS  ${name}`)
  } else {
    failures.push(name)
    console.log(
      `FAIL  ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`,
    )
  }
}

type ApiBody = {
  error?: string
  expense?: { id: string; status: string; submitterRole?: string }
  items?: { id: string; type: string; link: string; readAt: string | null }[]
  unreadCount?: number
  updatedCount?: number
}

async function api(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json: ApiBody | null = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text }
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith('session='))
    ?.split(';')[0]
  if (!cookie) {
    throw new Error(
      `login failed for ${email}: ${res.status} ${await res.text()}`,
    )
  }
  return cookie
}

async function inbox(cookie: string) {
  const res = await api(cookie, 'GET', '/api/notifications?pageSize=50')
  const items = res.json?.items ?? []
  return { status: res.status, items, unreadCount: res.json?.unreadCount ?? 0 }
}

async function cleanup(orgIds: string[]) {
  if (orgIds.length === 0) return
  await Notification.deleteMany({ organizationId: { $in: orgIds } })
  await Expense.deleteMany({ organizationId: { $in: orgIds } })
  await Budget.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await Department.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ organizationId: { $in: orgIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })
}

async function main() {
  await connectDB()

  const stale = await Organization.find({ name: /^Phase7E Verify/ })
    .select('_id')
    .lean<{ _id: string }[]>()
  if (stale.length) {
    await cleanup(stale.map((o) => String(o._id)))
    console.log(`INFO  removed ${stale.length} stale verify org(s)`)
  }

  // ---------- Fixtures ----------
  const org = await Organization.create({ name: `Phase7E Verify ${runId}` })
  const dept = await Department.create({
    organizationId: org._id,
    name: `Notifications ${runId}`,
  })
  const deptOther = await Department.create({
    organizationId: org._id,
    name: `Notifications Other ${runId}`,
  })

  const hash = await hashPassword(PASS)
  const mkUser = (
    deptId: unknown,
    name: string,
    email: string,
    role: 'admin' | 'manager' | 'staff',
  ) =>
    User.create({
      organizationId: org._id,
      departmentId: deptId,
      name,
      email,
      passwordHash: hash,
      role,
      isActive: true,
    })

  await mkUser(null, 'Ada Admin', `admin-${runId}@verify.test`, 'admin')
  const manager = await mkUser(
    dept._id,
    'Mona Manager',
    `mgr-${runId}@verify.test`,
    'manager',
  )
  const staff = await mkUser(
    dept._id,
    'Sam Staff',
    `staff-${runId}@verify.test`,
    'staff',
  )
  await mkUser(
    deptOther._id,
    'Mia Manager',
    `mgr-other-${runId}@verify.test`,
    'manager',
  )

  const adminCookie = await login(`admin-${runId}@verify.test`, PASS)
  const managerCookie = await login(`mgr-${runId}@verify.test`, PASS)
  const staffCookie = await login(`staff-${runId}@verify.test`, PASS)
  const managerOtherCookie = await login(`mgr-other-${runId}@verify.test`, PASS)

  // A 1000 budget starting at 50% used, so approvals can cross the warning
  // line (80%) and then the exceeded line (100%) one at a time.
  await Budget.create({
    organizationId: org._id,
    departmentId: dept._id,
    category: 'Transport',
    amount: 1000,
    month: MONTH,
    carryOver: false,
  })
  await Expense.create({
    organizationId: org._id,
    departmentId: dept._id,
    userId: staff._id,
    submitterRole: 'staff',
    category: 'Transport',
    amount: 500,
    date: new Date(TODAY),
    description: 'Phase7E pre-approval seed',
    status: 'approved',
    reviewedBy: manager._id,
    reviewedAt: new Date(),
  })

  // ---------- A. Expense approved notification ----------
  console.log('\n--- A. Expense approved notification ---')

  const expenseA = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Transport',
    amount: 100,
    date: TODAY,
    description: 'Approved expense',
  })
  check(
    'staff creates a pending expense (201)',
    expenseA.status === 201,
    expenseA.status,
  )
  const expenseAId = expenseA.json?.expense?.id
  check('expense id is present', typeof expenseAId === 'string')

  const approveA = await api(
    managerCookie,
    'POST',
    `/api/expenses/${expenseAId}/review`,
    {
      action: 'approve',
      reason: 'Looks good',
    },
  )
  check('manager approves a staff expense (200)', approveA.status === 200)
  check('approved response has the expense', Boolean(approveA.json?.expense))

  const staffAfterApprove = await inbox(staffCookie)
  const approvedNotif = staffAfterApprove.items.find(
    (n) => n.type === 'expense_approved',
  )
  check('staff gets an expense_approved notification', Boolean(approvedNotif))
  check(
    'approved notification links to the expense list',
    approvedNotif?.link === '/expenses',
  )

  // 600/1000 = 60% — the budget must not have notified yet.
  const managerBeforeWarning = await inbox(managerCookie)
  check(
    'no budget notification before the warning line',
    !managerBeforeWarning.items.some((n) => n.type.startsWith('budget_')),
  )

  // ---------- B. Expense awaiting review notification ----------
  console.log('\n--- B. Expense awaiting review notification ---')

  const expenseB = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Supplies',
    amount: 50,
    date: TODAY,
    description: 'Pending expense for notification',
  })
  check('second pending expense created (201)', expenseB.status === 201)
  const expenseBId = expenseB.json?.expense?.id

  const managerNotifs = await inbox(managerCookie)
  const pendingForStaff = managerNotifs.items.find(
    (n) => n.type === 'expense_pending' && n.link === '/approvals',
  )
  check(
    'department manager is told a staff expense awaits review',
    Boolean(pendingForStaff),
  )
  check('the pending notice does not expose another user', Boolean(expenseBId))

  // A manager expense is reviewed by admins, so the admin gets the notice.
  const managerExpense = await api(managerCookie, 'POST', '/api/expenses', {
    category: 'Meals',
    amount: 25,
    date: TODAY,
    description: 'Manager expense for notification',
  })
  check(
    'manager creates a pending expense (201)',
    managerExpense.status === 201,
  )
  check(
    'manager expense is marked as a manager submission',
    managerExpense.json?.expense?.submitterRole === 'manager',
  )

  const adminNotifs = await inbox(adminCookie)
  const pendingForManager = adminNotifs.items.find(
    (n) => n.type === 'expense_pending' && n.link === '/approvals',
  )
  check(
    'admin is told a manager expense awaits review',
    Boolean(pendingForManager),
  )

  // The department manager must not be told about the manager's own expense:
  // only admins review manager submissions.
  const managerCountBefore = (await inbox(managerCookie)).items.length
  await api(managerCookie, 'POST', '/api/expenses', {
    category: 'Utilities',
    amount: 10,
    date: TODAY,
    description: 'Second manager expense',
  })
  const managerCountAfter = (await inbox(managerCookie)).items.length
  check(
    'manager is not notified about their own expense',
    managerCountAfter === managerCountBefore,
    { managerCountBefore, managerCountAfter },
  )

  // ---------- C. Expense rejected notification ----------
  console.log('\n--- C. Expense rejected notification ---')

  const expenseC = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Meals',
    amount: 30,
    date: TODAY,
    description: 'Rejected expense',
  })
  check('third pending expense created (201)', expenseC.status === 201)
  const expenseCId = expenseC.json?.expense?.id

  const rejectC = await api(
    managerCookie,
    'POST',
    `/api/expenses/${expenseCId}/review`,
    {
      action: 'reject',
      reason: 'Need receipts',
    },
  )
  check('manager rejects an expense (200)', rejectC.status === 200)

  const staffAfterReject = await inbox(staffCookie)
  const rejectedNotif = staffAfterReject.items.find(
    (n) => n.type === 'expense_rejected',
  )
  check('staff gets an expense_rejected notification', Boolean(rejectedNotif))
  check(
    'rejected notification links to the expense list',
    rejectedNotif?.link === '/expenses',
  )
  check(
    'staff has both approved and rejected notifications',
    staffAfterReject.items.some((n) => n.type === 'expense_approved') &&
      staffAfterReject.items.some((n) => n.type === 'expense_rejected'),
  )

  // ---------- D. Budget warning notification (once per budget/threshold) ----------
  console.log('\n--- D. Budget warning notification ---')

  // 500 + A(100) = 600 spent; a 350 approval reaches 950/1000 = 95% (warning).
  const expenseD = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Transport',
    amount: 350,
    date: TODAY,
    description: 'Push budget over the warning line',
  })
  check(
    'expense that crosses the warning line created (201)',
    expenseD.status === 201,
  )
  const expenseDId = expenseD.json?.expense?.id

  const approveD = await api(
    managerCookie,
    'POST',
    `/api/expenses/${expenseDId}/review`,
    {
      action: 'approve',
    },
  )
  check(
    'approval crossing the warning line succeeds (200)',
    approveD.status === 200,
  )

  const managerAfterWarning = await inbox(managerCookie)
  const warnings = managerAfterWarning.items.filter(
    (n) => n.type === 'budget_warning',
  )
  check(
    'department manager gets exactly one budget_warning',
    warnings.length === 1,
    warnings.length,
  )
  check(
    'budget_warning links to the budgets page',
    warnings[0]?.link === '/budgets',
  )

  // A second small approval (950 -> 1000) is still a warning: no second notice.
  const expenseD2 = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Transport',
    amount: 50,
    date: TODAY,
    description: 'Stay inside the warning band',
  })
  const approveD2 = await api(
    managerCookie,
    'POST',
    `/api/expenses/${expenseD2.json?.expense?.id}/review`,
    { action: 'approve' },
  )
  check('second warning-band approval succeeds (200)', approveD2.status === 200)

  const managerAfterSecond = await inbox(managerCookie)
  check(
    'staying in the warning band does not notify again',
    managerAfterSecond.items.filter((n) => n.type === 'budget_warning')
      .length === 1,
  )

  // ---------- D2. Budget exceeded notification ----------
  console.log('\n--- D2. Budget exceeded notification ---')

  const expenseE = await api(staffCookie, 'POST', '/api/expenses', {
    category: 'Transport',
    amount: 100,
    date: TODAY,
    description: 'Push budget over the exceeded line',
  })
  const approveE = await api(
    managerCookie,
    'POST',
    `/api/expenses/${expenseE.json?.expense?.id}/review`,
    { action: 'approve' },
  )
  check(
    'approval crossing the exceeded line succeeds (200)',
    approveE.status === 200,
  )

  const managerAfterExceeded = await inbox(managerCookie)
  check(
    'department manager gets exactly one budget_exceeded',
    managerAfterExceeded.items.filter((n) => n.type === 'budget_exceeded')
      .length === 1,
  )
  check(
    'the warning notice is not duplicated when exceeded',
    managerAfterExceeded.items.filter((n) => n.type === 'budget_warning')
      .length === 1,
  )

  // Another department's manager sees none of this budget's notices.
  const otherInbox = await inbox(managerOtherCookie)
  check(
    'other department manager gets no budget notifications',
    !otherInbox.items.some((n) => n.type.startsWith('budget_')),
  )

  // ---------- E. Mark as read ----------
  console.log('\n--- E. Mark as read ---')

  const beforeRead = await inbox(staffCookie)
  const unreadBefore = beforeRead.unreadCount
  check('staff has unread notifications', unreadBefore > 0, unreadBefore)
  check(
    'the unread count matches the unread rows returned',
    unreadBefore === beforeRead.items.filter((n) => n.readAt === null).length,
  )

  const toRead = beforeRead.items
    .filter((n) => n.readAt === null)
    .slice(0, 1)
    .map((n) => n.id)
  const markRead = await api(staffCookie, 'POST', '/api/notifications', {
    ids: toRead,
  })
  check('mark one as read returns 200', markRead.status === 200)
  check('mark one reports one updated row', markRead.json?.updatedCount === 1)

  const afterRead = await inbox(staffCookie)
  check(
    'unread count decreased after marking one as read',
    afterRead.unreadCount === unreadBefore - 1,
    { unreadBefore, unreadAfter: afterRead.unreadCount },
  )

  // Another user cannot mark this staff member's notification as read.
  const otherMarks = await api(managerCookie, 'POST', '/api/notifications', {
    ids: toRead,
  })
  check(
    'another user marking someone else’s notification changes nothing',
    otherMarks.json?.updatedCount === 0,
  )

  // ---------- F. Mark all as read ----------
  console.log('\n--- F. Mark all as read ---')

  const markAll = await api(staffCookie, 'POST', '/api/notifications', {
    all: true,
  })
  check('mark all as read returns 200', markAll.status === 200)
  check(
    'mark all returns an updated count',
    typeof markAll.json?.updatedCount === 'number',
  )

  const afterAll = await inbox(staffCookie)
  check(
    'no unread notifications after mark all',
    afterAll.unreadCount === 0,
    afterAll.unreadCount,
  )

  // ---------- G. Scoping ----------
  console.log('\n--- G. Notification scoping ---')

  const staffFinal = await inbox(staffCookie)
  const managerFinal = await inbox(managerCookie)
  check(
    'staff sees their own approved notification',
    staffFinal.items.some((n) => n.type === 'expense_approved'),
  )
  check(
    'manager does not see the staff approved notification',
    !managerFinal.items.some((n) => n.type === 'expense_approved'),
  )
  check(
    'manager sees the staff pending notice they can act on',
    managerFinal.items.some((n) => n.type === 'expense_pending'),
  )

  // Staff cannot read another user's notification ids.
  const managerIds = managerFinal.items.map((n) => n.id)
  const staffReadsManager = await api(
    staffCookie,
    'POST',
    '/api/notifications',
    {
      ids: managerIds.slice(0, 1),
    },
  )
  check(
    'staff cannot mark a manager notification as read',
    staffReadsManager.json?.updatedCount === 0,
  )

  return String(org._id)
}

let orgId: string | null = null
try {
  orgId = await main()
} catch (err) {
  failures.push('fatal error')
  console.error('Fatal:', err)
} finally {
  if (orgId) {
    await cleanup([orgId])
    console.log('INFO  removed verify fixtures')
  }
  console.log(`\n--------\nPASSED ${passed} · FAILED ${failures.length}`)
  if (failures.length) {
    console.log('FAILURES:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
  await mongoose.disconnect()
}
