// Phase 3 (Budgets and approvals) end-to-end verification against the master
// prompt.
//
// Usage: npx tsx scripts/verify-phase3.mts   (dev server must be running)
//
// Creates a throwaway organization with two departments and several users, then
// exercises the real HTTP API and the browser UI: budget CRUD scoped to the
// manager's department, approve/reject with an optional reason, staff seeing the
// resulting status, cross-department 404s, role denials and audit entries.
// All fixtures are removed at the end; demo data is never touched.

import { loadEnvFile } from 'node:process'
import mongoose from 'mongoose'
import type { Page } from 'playwright'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { Organization } = await import('../models/organization.ts')
const { Department } = await import('../models/department.ts')
const { User } = await import('../models/user.ts')
const { Expense } = await import('../models/expense.ts')
const { Budget } = await import('../models/budget.ts')
const { AuditLog } = await import('../models/audit-log.ts')

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000'
const PASS = 'VerifyPass123!'
const runId = Date.now().toString(36)

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

type BudgetJson = {
  id: string
  organizationId: string
  departmentId: string
  category: string
  amount: number
  month: string
  carryOver: boolean
  createdAt: string
}

type ExpenseJson = {
  id: string
  organizationId: string
  departmentId: string | null
  userId: string
  submitterRole: string
  category: string
  amount: number
  date: string
  description: string
  status: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  createdAt: string
}

type ApiBody = {
  error?: string
  details?: { fieldErrors?: Record<string, string[]> }
  budget?: BudgetJson
  expense?: ExpenseJson
  items?: ExpenseJson[]
  budgets?: BudgetJson[]
  total?: number
  success?: boolean
  created?: number
  skipped?: number
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
    /* non-JSON body (e.g. the 403 page from middleware) */
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

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

// `YYYY-MM` for the current month plus `offset` months.
function month(offset = 0): string {
  const now = new Date()
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
  )
  return d.toISOString().slice(0, 7)
}

async function main() {
  await connectDB()

  // Remove fixtures from an interrupted earlier run (only this script creates
  // organizations with this prefix).
  const stale = await Organization.find({ name: /^Phase3 Verify/ })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  if (stale.length) {
    const ids = stale.map((o) => o._id)
    await Budget.deleteMany({ organizationId: { $in: ids } })
    await Expense.deleteMany({ organizationId: { $in: ids } })
    await AuditLog.deleteMany({ organizationId: { $in: ids } })
    await Department.deleteMany({ organizationId: { $in: ids } })
    await User.deleteMany({ organizationId: { $in: ids } })
    await Organization.deleteMany({ _id: { $in: ids } })
    console.log(`INFO  removed ${ids.length} stale verify org(s)`)
  }

  const orgV = await Organization.create({ name: `Phase3 Verify ${runId}` })
  const orgB = await Organization.create({
    name: `Phase3 Verify Other ${runId}`,
  })
  const deptA = await Department.create({
    organizationId: orgV._id,
    name: `Dept A ${runId}`,
  })
  const deptB = await Department.create({
    organizationId: orgV._id,
    name: `Dept B ${runId}`,
  })
  const deptOther = await Department.create({
    organizationId: orgB._id,
    name: `Dept Other ${runId}`,
  })
  const hash = await hashPassword(PASS)

  const mkUser = (
    orgId: unknown,
    deptId: unknown,
    name: string,
    email: string,
    role: 'admin' | 'manager' | 'staff',
  ) =>
    User.create({
      organizationId: orgId,
      departmentId: deptId,
      name,
      email,
      passwordHash: hash,
      role,
      isActive: true,
    })

  const mgrA = await mkUser(
    orgV._id,
    deptA._id,
    'Mona Manager',
    `mgr-a-${runId}@verify.test`,
    'manager',
  )
  await mkUser(
    orgV._id,
    deptA._id,
    'Sam Staff',
    `staff-a1-${runId}@verify.test`,
    'staff',
  )
  await mkUser(
    orgV._id,
    deptA._id,
    'Sara Staff',
    `staff-a2-${runId}@verify.test`,
    'staff',
  )
  await mkUser(
    orgV._id,
    deptB._id,
    'Mo Manager',
    `mgr-b-${runId}@verify.test`,
    'manager',
  )
  await mkUser(
    orgV._id,
    deptB._id,
    'Bo Staff',
    `staff-b-${runId}@verify.test`,
    'staff',
  )
  await mkUser(
    orgV._id,
    null,
    'Abe Admin',
    `admin-${runId}@verify.test`,
    'admin',
  )
  await mkUser(
    orgV._id,
    null,
    'Noor NoDept',
    `mgr-null-${runId}@verify.test`,
    'manager',
  )
  await mkUser(
    orgB._id,
    deptOther._id,
    'Otto Other',
    `mgr-other-${runId}@verify.test`,
    'manager',
  )

  const manager = await login(`mgr-a-${runId}@verify.test`, PASS)
  const managerB = await login(`mgr-b-${runId}@verify.test`, PASS)
  const staff1 = await login(`staff-a1-${runId}@verify.test`, PASS)
  const staff2 = await login(`staff-a2-${runId}@verify.test`, PASS)
  const staffB = await login(`staff-b-${runId}@verify.test`, PASS)
  const admin = await login(`admin-${runId}@verify.test`, PASS)
  const managerNull = await login(`mgr-null-${runId}@verify.test`, PASS)
  const managerOther = await login(`mgr-other-${runId}@verify.test`, PASS)

  // ---------- Budgets: create ----------
  const mkBudget = (cookie: string, body: Record<string, unknown>) =>
    api(cookie, 'POST', '/api/budgets', body)

  const b1 = await mkBudget(manager, {
    category: 'Meals',
    amount: 1000,
    month: month(0),
  })
  check(
    'manager creates a budget (201) for their own department',
    b1.status === 201 &&
      b1.json?.budget?.departmentId === String(deptA._id) &&
      b1.json?.budget?.organizationId === String(orgV._id) &&
      b1.json?.budget?.amount === 1000,
    b1.json ?? b1.text,
  )

  const b1again = await mkBudget(manager, {
    category: 'Meals',
    amount: 500,
    month: month(0),
  })
  check(
    'duplicate category+month is rejected (409)',
    b1again.status === 409,
    b1again.json,
  )

  const b2 = await mkBudget(manager, {
    category: 'Meals',
    amount: 1200,
    month: month(1),
  })
  check(
    'same category in another month is allowed (201)',
    b2.status === 201,
    b2.json,
  )

  const b3 = await mkBudget(managerB, {
    category: 'Transport',
    amount: 800,
    month: month(0),
  })
  check(
    'a second manager budgets their own department (201)',
    b3.status === 201 && b3.json?.budget?.departmentId === String(deptB._id),
    b3.json,
  )

  const bStaff = await mkBudget(staff1, {
    category: 'Supplies',
    amount: 100,
    month: month(0),
  })
  check('staff cannot create budgets (403)', bStaff.status === 403, bStaff.json)

  const bAdmin = await mkBudget(admin, {
    category: 'Supplies',
    amount: 100,
    month: month(0),
  })
  check(
    'admins cannot create budgets (403, read-only)',
    bAdmin.status === 403,
    bAdmin.json,
  )

  const bNoDept = await mkBudget(managerNull, {
    category: 'Supplies',
    amount: 100,
    month: month(0),
  })
  check(
    'a manager without a department gets a clear 400',
    bNoDept.status === 400 && /department/i.test(bNoDept.json?.error ?? ''),
    bNoDept.json,
  )

  const bBadAmount = await mkBudget(manager, {
    category: 'Utilities',
    amount: 0,
    month: month(0),
  })
  check(
    'budget amount must be > 0 (400)',
    bBadAmount.status === 400,
    bBadAmount.json,
  )

  const bBadMonth = await mkBudget(manager, {
    category: 'Utilities',
    amount: 10,
    month: '2026-13',
  })
  check(
    'budget month must be YYYY-MM (400)',
    bBadMonth.status === 400,
    bBadMonth.json,
  )

  const bInjected = await mkBudget(manager, {
    category: 'Utilities',
    amount: 10,
    month: month(0),
    departmentId: String(deptB._id),
  })
  check(
    'client-supplied departmentId is rejected (400, rule 2)',
    bInjected.status === 400,
    bInjected.json,
  )

  // ---------- Budgets: read scopes ----------
  const listBudgets = (cookie: string, qs = '') =>
    api(cookie, 'GET', `/api/budgets${qs}`)

  const managerList = await listBudgets(manager)
  check(
    'manager lists only their own department budgets',
    managerList.json?.total === 2 &&
      managerList.json?.items?.every(
        (b) => b.departmentId === String(deptA._id),
      ),
    managerList.json,
  )

  const managerBList = await listBudgets(managerB)
  check(
    'another manager sees only their department',
    managerBList.json?.total === 1 &&
      managerBList.json?.items?.[0]?.departmentId === String(deptB._id),
    managerBList.json,
  )

  const adminList = await listBudgets(admin)
  check(
    'admin sees every department budget in the organization',
    adminList.json?.total === 3,
    adminList.json,
  )

  const staffList = await listBudgets(staff1)
  check(
    'staff cannot list budgets (403)',
    staffList.status === 403,
    staffList.json,
  )

  const otherOrgList = await listBudgets(managerOther)
  check(
    'another organization sees no budgets (tenant isolation)',
    otherOrgList.json?.total === 0,
    otherOrgList.json,
  )

  const monthFilter = await listBudgets(manager, `?month=${month(1)}`)
  check(
    'budget month filter narrows the list',
    monthFilter.json?.total === 1 &&
      monthFilter.json?.items?.[0]?.month === month(1),
    monthFilter.json,
  )

  const categoryFilter = await listBudgets(
    admin,
    `?category=${encodeURIComponent('Transport')}`,
  )
  check(
    'budget category filter narrows the list',
    categoryFilter.json?.total === 1 &&
      categoryFilter.json?.items?.[0]?.category === 'Transport',
    categoryFilter.json,
  )

  // ---------- Budgets: update and delete ----------
  const budgetId = b1.json!.budget!.id

  const upd = await api(manager, 'PATCH', `/api/budgets/${budgetId}`, {
    amount: 1500,
  })
  check(
    'manager updates their own budget (200)',
    upd.status === 200 && upd.json?.budget?.amount === 1500,
    upd.json,
  )

  const updOtherDept = await api(
    managerB,
    'PATCH',
    `/api/budgets/${budgetId}`,
    { amount: 1 },
  )
  check(
    "another department's budget is a 404 on update",
    updOtherDept.status === 404,
    updOtherDept.json,
  )

  const updNull = await api(managerNull, 'PATCH', `/api/budgets/${budgetId}`, {
    amount: 1,
  })
  check(
    'a manager without a department cannot update any budget (404)',
    updNull.status === 404,
    updNull.json,
  )

  const updAdmin = await api(admin, 'PATCH', `/api/budgets/${budgetId}`, {
    amount: 1,
  })
  check(
    'admins cannot update budgets (403)',
    updAdmin.status === 403,
    updAdmin.json,
  )

  const updBad = await api(manager, 'PATCH', `/api/budgets/${budgetId}`, {
    amount: -5,
  })
  check(
    'invalid budget update is rejected (400)',
    updBad.status === 400,
    updBad.json,
  )

  const updInject = await api(manager, 'PATCH', `/api/budgets/${budgetId}`, {
    departmentId: String(deptB._id),
  })
  check(
    'update rejects client-supplied departmentId (400)',
    updInject.status === 400,
    updInject.json,
  )

  const delOtherDept = await api(
    manager,
    'DELETE',
    `/api/budgets/${b3.json!.budget!.id}`,
  )
  check(
    "another department's budget is a 404 on delete",
    delOtherDept.status === 404,
    delOtherDept.json,
  )

  const delAdmin = await api(admin, 'DELETE', `/api/budgets/${budgetId}`)
  check(
    'admins cannot delete budgets (403)',
    delAdmin.status === 403,
    delAdmin.json,
  )

  const delStaff = await api(staff1, 'DELETE', `/api/budgets/${budgetId}`)
  check(
    'staff cannot delete budgets (403)',
    delStaff.status === 403,
    delStaff.json,
  )

  const del = await api(
    manager,
    'DELETE',
    `/api/budgets/${b2.json!.budget!.id}`,
  )
  check(
    'manager deletes their own budget (200)',
    del.status === 200 && del.json?.success === true,
    del.json,
  )

  const gone = await api(manager, 'GET', `/api/budgets/${b2.json!.budget!.id}`)
  check('deleted budget is a 404', gone.status === 404, gone.json)

  // ---------- Phase 7C: copy budgets between months ----------
  const copyFrom = month(4)
  const copyTo = month(5)
  const copyBudget = (cookie: string, body: Record<string, unknown>) =>
    api(cookie, 'POST', '/api/budgets/copy', body)

  await mkBudget(manager, {
    category: 'Transport',
    amount: 400,
    month: copyFrom,
  })
  await mkBudget(manager, { category: 'Meals', amount: 250, month: copyFrom })
  // Target already has Transport: the copy must skip it, not overwrite it.
  await mkBudget(manager, { category: 'Transport', amount: 999, month: copyTo })

  const copied = await copyBudget(manager, {
    fromMonth: copyFrom,
    toMonth: copyTo,
  })
  check(
    'copy budgets creates the missing categories and skips existing ones',
    copied.status === 200 &&
      copied.json?.created === 1 &&
      copied.json?.skipped === 1,
    copied.json,
  )

  const copiedMeals = await api(
    manager,
    'GET',
    `/api/budgets?month=${copyTo}&category=Meals`,
  )
  check(
    'the copied budget keeps the source amount (250)',
    copiedMeals.json?.total === 1 &&
      copiedMeals.json?.items?.[0]?.amount === 250,
    copiedMeals.json,
  )

  const copyOverwrote = await api(
    manager,
    'GET',
    `/api/budgets?month=${copyTo}&category=Transport`,
  )
  check(
    'the existing target budget was not overwritten (999)',
    copyOverwrote.json?.items?.[0]?.amount === 999,
    copyOverwrote.json,
  )

  const copyAgain = await copyBudget(manager, {
    fromMonth: copyFrom,
    toMonth: copyTo,
  })
  check(
    'copying again creates nothing and skips both categories',
    copyAgain.json?.created === 0 && copyAgain.json?.skipped === 2,
    copyAgain.json,
  )

  for (const [name, body] of Object.entries({
    'an invalid month': { fromMonth: '2026-13', toMonth: copyTo },
    'a client-supplied departmentId': {
      fromMonth: copyFrom,
      toMonth: copyTo,
      departmentId: 'x',
    },
  })) {
    const bad = await copyBudget(manager, body)
    check(`copy budgets rejects ${name} (400)`, bad.status === 400, bad.json)
  }

  const copyStaff = await copyBudget(staff1, {
    fromMonth: copyFrom,
    toMonth: copyTo,
  })
  const copyAdmin = await copyBudget(admin, {
    fromMonth: copyFrom,
    toMonth: copyTo,
  })
  check(
    'copy budgets is manager-only (staff and admin 403)',
    copyStaff.status === 403 && copyAdmin.status === 403,
    [copyStaff.status, copyAdmin.status],
  )

  // Phase 7C: the rollover flag round-trips through the API.
  const carryBudget = await mkBudget(manager, {
    category: 'Events',
    amount: 300,
    month: copyTo,
    carryOver: true,
  })
  check(
    'a budget can opt into carry-over (201, carryOver true)',
    carryBudget.status === 201 && carryBudget.json?.budget?.carryOver === true,
    carryBudget.json,
  )
  const carryOff = await api(
    manager,
    'PATCH',
    `/api/budgets/${carryBudget.json!.budget!.id}`,
    { carryOver: false },
  )
  check(
    'the rollover flag can be switched off again (200)',
    carryOff.status === 200 && carryOff.json?.budget?.carryOver === false,
    carryOff.json,
  )

  const budgetAudits = await AuditLog.find({
    organizationId: orgV._id,
    entity: 'Budget',
  }).lean<{ action: string; userId: unknown }[]>()

  check(
    'budget create/update/delete write audit entries (rule 7)',
    ['create', 'update', 'delete'].every((action) =>
      budgetAudits.some(
        (a) => a.action === action && String(a.userId) === String(mgrA._id),
      ),
    ),
    budgetAudits.map((a) => `${a.action}:${String(a.userId)}`),
  )
  check(
    'each copied budget writes its own create audit (2 copies = >= 2 audits)',
    budgetAudits.filter(
      (a) => a.action === 'create' && String(a.userId) === String(mgrA._id),
    ).length >= 2,
    budgetAudits.filter((a) => a.action === 'create').length,
  )

  // ---------- Approvals ----------
  const mkExpense = (cookie: string, body: Record<string, unknown>) =>
    api(cookie, 'POST', '/api/expenses', body)

  const e1 = await mkExpense(staff1, {
    category: 'Meals',
    amount: 100,
    date: day(-3),
    description: 'A meals dept A',
  })
  const e2 = await mkExpense(staff1, {
    category: 'Supplies',
    amount: 50,
    date: day(-2),
    description: 'B supplies dept A',
  })
  const e3 = await mkExpense(staff2, {
    category: 'Transport',
    amount: 25,
    date: day(-1),
    description: 'C transport dept A',
  })
  const e4 = await mkExpense(staffB, {
    category: 'Meals',
    amount: 70,
    date: day(0),
    description: 'D meals dept B',
  })
  check(
    'staff expenses start pending',
    [e1, e2, e3, e4].every(
      (r) => r.status === 201 && r.json?.expense?.status === 'pending',
    ),
    [e1.status, e2.status, e3.status, e4.status],
  )

  const review = (cookie: string, id: string, body: Record<string, unknown>) =>
    api(cookie, 'POST', `/api/expenses/${id}/review`, body)

  const e1Id = e1.json!.expense!.id
  const e2Id = e2.json!.expense!.id
  const e3Id = e3.json!.expense!.id
  const e4Id = e4.json!.expense!.id

  const approve = await review(manager, e1Id, { action: 'approve' })
  check(
    'manager approves a pending expense (200, approved)',
    approve.status === 200 &&
      approve.json?.expense?.status === 'approved' &&
      approve.json?.expense?.reviewedBy === String(mgrA._id) &&
      !!approve.json?.expense?.reviewedAt &&
      approve.json?.expense?.reviewNote === null,
    approve.json,
  )

  const approveAgain = await review(manager, e1Id, { action: 'approve' })
  check(
    'an already reviewed expense cannot be reviewed again (409)',
    approveAgain.status === 409,
    approveAgain.json,
  )

  const reject = await review(manager, e2Id, {
    action: 'reject',
    reason: 'Missing receipt',
  })
  check(
    'manager rejects with an optional reason (200)',
    reject.status === 200 &&
      reject.json?.expense?.status === 'rejected' &&
      reject.json?.expense?.reviewNote === 'Missing receipt',
    reject.json,
  )

  const reviewAudits = await AuditLog.find({
    organizationId: orgV._id,
    entity: 'Expense',
    action: { $in: ['approve', 'reject'] },
  }).lean<{ action: string; entityId: unknown }[]>()
  check(
    'approve and reject write audit entries (rule 7)',
    reviewAudits.some(
      (a) => a.action === 'approve' && String(a.entityId) === e1Id,
    ) &&
      reviewAudits.some(
        (a) => a.action === 'reject' && String(a.entityId) === e2Id,
      ),
    reviewAudits.map((a) => a.action),
  )

  const staffSees = await api(staff1, 'GET', `/api/expenses/${e2Id}`)
  check(
    'staff see the rejected status and reason',
    staffSees.json?.expense?.status === 'rejected' &&
      staffSees.json?.expense?.reviewNote === 'Missing receipt',
    staffSees.json,
  )

  const staffReview = await review(staff1, e3Id, { action: 'approve' })
  check(
    'staff cannot review expenses (403)',
    staffReview.status === 403,
    staffReview.json,
  )

  const crossDept = await review(manager, e4Id, { action: 'approve' })
  check(
    "a manager cannot review another department's expense (404)",
    crossDept.status === 404,
    crossDept.json,
  )

  const deptBManager = await review(managerB, e4Id, { action: 'approve' })
  check(
    'the owning manager can review their department expense (200)',
    deptBManager.status === 200 &&
      deptBManager.json?.expense?.status === 'approved',
    deptBManager.json,
  )

  const nullManager = await review(managerNull, e3Id, { action: 'approve' })
  check(
    'a manager without a department cannot review anything (404)',
    nullManager.status === 404,
    nullManager.json,
  )

  const otherOrg = await review(managerOther, e3Id, { action: 'approve' })
  check(
    "another organization's manager cannot review (404)",
    otherOrg.status === 404,
    otherOrg.json,
  )

  const adminReview = await review(admin, e3Id, {
    action: 'reject',
    reason: 'Duplicate claim',
  })
  check(
    'an admin cannot review a staff expense (404 — staff go to their manager)',
    adminReview.status === 404,
    adminReview.json,
  )

  // ---------- Phase 7B: managers record their own expenses ----------
  const mgrExpense = await mkExpense(manager, {
    category: 'Transport',
    amount: 42,
    date: day(-1),
    description: 'G manager own transport',
  })
  check(
    'a manager records their own expense (201: submitterRole manager, their department, pending)',
    mgrExpense.status === 201 &&
      mgrExpense.json?.expense?.submitterRole === 'manager' &&
      mgrExpense.json?.expense?.departmentId === String(deptA._id) &&
      mgrExpense.json?.expense?.userId === String(mgrA._id) &&
      mgrExpense.json?.expense?.status === 'pending',
    mgrExpense.json,
  )
  const mgrExpenseId = mgrExpense.json!.expense!.id

  const injectSubmitter = await mkExpense(manager, {
    category: 'Other',
    amount: 5,
    date: day(0),
    submitterRole: 'staff',
  })
  check(
    'an expense body cannot set submitterRole (400, rule 3)',
    injectSubmitter.status === 400,
    injectSubmitter.json,
  )

  const ownReview = await review(manager, mgrExpenseId, { action: 'approve' })
  check(
    'a manager cannot review their own expense (404)',
    ownReview.status === 404,
    ownReview.json,
  )

  // The queue pages are server-rendered, so their HTML is the cheapest way to
  // prove each role's review queue contents.
  const managerQueue = await api(manager, 'GET', '/approvals')
  check(
    "the manager's approvals page never lists their own expense",
    managerQueue.status === 200 &&
      !managerQueue.text.includes('G manager own transport'),
    managerQueue.status,
  )

  const adminQueue = await api(admin, 'GET', '/approvals')
  check(
    "the admin's approvals page lists pending manager expenses",
    adminQueue.status === 200 &&
      adminQueue.text.includes('G manager own transport'),
    adminQueue.status,
  )

  const adminApprovesMgr = await review(admin, mgrExpenseId, {
    action: 'approve',
  })
  check(
    'an admin approves a manager expense (200, approved, not the manager)',
    adminApprovesMgr.status === 200 &&
      adminApprovesMgr.json?.expense?.status === 'approved' &&
      !!adminApprovesMgr.json?.expense?.reviewedBy &&
      adminApprovesMgr.json?.expense?.reviewedBy !== String(mgrA._id),
    adminApprovesMgr.json,
  )

  const staffExpenseByManager = await api(
    manager,
    'PATCH',
    `/api/expenses/${e3Id}`,
    {
      amount: 26,
    },
  )
  check(
    "a manager cannot edit another staff member's expense (403)",
    staffExpenseByManager.status === 403,
    staffExpenseByManager.json,
  )

  const mgrDraft = await mkExpense(manager, {
    category: 'Events',
    amount: 10,
    date: day(0),
    description: 'H manager draft',
  })
  const mgrDraftId = mgrDraft.json!.expense!.id
  const mgrEdit = await api(manager, 'PATCH', `/api/expenses/${mgrDraftId}`, {
    amount: 12,
  })
  check(
    'a manager edits their own pending expense (200)',
    mgrEdit.status === 200 && mgrEdit.json?.expense?.amount === 12,
    mgrEdit.json,
  )

  const mgrDelete = await api(manager, 'DELETE', `/api/expenses/${mgrDraftId}`)
  check(
    'a manager deletes their own pending expense (200)',
    mgrDelete.status === 200 && mgrDelete.json?.success === true,
    mgrDelete.json,
  )

  const adminPatch = await api(
    admin,
    'PATCH',
    `/api/expenses/${mgrExpenseId}`,
    {
      amount: 50,
    },
  )
  check(
    'admins stay read-only for expenses (403)',
    adminPatch.status === 403,
    adminPatch.json,
  )

  // Phase 7B: approved manager expenses count toward the department budget.
  const transportBudget = await mkBudget(manager, {
    category: 'Transport',
    amount: 500,
    month: month(0),
  })
  check(
    'manager creates a budget for the budget-counting check (201)',
    transportBudget.status === 201,
    transportBudget.json,
  )

  const { budgetVsActual } = await import('../services/report-service.ts')
  const mgrBudgetRows = await budgetVsActual(
    {
      userId: String(mgrA._id),
      organizationId: String(orgV._id),
      departmentId: String(deptA._id),
      role: 'manager',
    },
    month(0),
  )
  const transportRow = mgrBudgetRows.find((row) => row.category === 'Transport')
  check(
    "an approved manager expense counts toward the department's budget (spent 42)",
    transportRow?.spent === 42,
    transportRow,
  )

  const badAction = await review(manager, e3Id, { action: 'maybe' })
  check(
    'an unknown review action is rejected (400)',
    badAction.status === 400,
    badAction.json,
  )

  const longReason = await review(manager, e3Id, {
    action: 'reject',
    reason: 'x'.repeat(201),
  })
  check(
    'a reason longer than 200 characters is rejected (400)',
    longReason.status === 400,
    longReason.json,
  )

  const injectReview = await review(manager, e3Id, {
    action: 'approve',
    status: 'approved',
  })
  check(
    'review rejects extra fields such as status (400, rule 2)',
    injectReview.status === 400,
    injectReview.json,
  )

  const badId = await review(manager, 'not-an-id', { action: 'approve' })
  check('an invalid expense id is a 404', badId.status === 404, badId.json)

  const anonymous = await review('', e3Id, { action: 'approve' })
  check(
    'unauthenticated review is 401',
    anonymous.status === 401,
    anonymous.status,
  )

  // Pending queue scoped to the manager's department. These two stay pending
  // for the queue check and the UI approval step.
  const e5 = await mkExpense(staff1, {
    category: 'Events',
    amount: 25,
    date: day(0),
    description: 'E waiting approval',
  })
  const e6 = await mkExpense(staffB, {
    category: 'Events',
    amount: 30,
    date: day(0),
    description: 'F pending dept B',
  })
  const e5Id = e5.json!.expense!.id
  const e6Id = e6.json!.expense!.id

  const pendingQueue = await api(
    manager,
    'GET',
    '/api/expenses?status=pending&pageSize=100',
  )
  const pendingIds = new Set((pendingQueue.json?.items ?? []).map((x) => x.id))
  check(
    "manager's pending queue holds only their department",
    pendingIds.has(e5Id) && !pendingIds.has(e6Id),
    [...pendingIds],
  )

  // ---------- UI flow ----------
  await uiChecks({
    managerEmail: `mgr-a-${runId}@verify.test`,
    staffEmail: `staff-a1-${runId}@verify.test`,
    adminEmail: `admin-${runId}@verify.test`,
    uiMonth: month(3),
    copyFrom: copyFrom,
    copyTo: month(9),
    approvedDescription: 'E waiting approval',
    staffCookie: staff1,
  })

  // ---------- Cleanup ----------
  const orgIds = [orgV._id, orgB._id]
  const userIds = (
    await User.find({ organizationId: { $in: orgIds } })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId }[]>()
  ).map((u) => u._id)
  await Budget.deleteMany({ organizationId: { $in: orgIds } })
  await Expense.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await Department.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ _id: { $in: userIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })

  const leftovers = await Promise.all([
    Budget.countDocuments({ organizationId: { $in: orgIds } }),
    Expense.countDocuments({ organizationId: { $in: orgIds } }),
    Department.countDocuments({ organizationId: { $in: orgIds } }),
    User.countDocuments({ _id: { $in: userIds } }),
  ])
  console.log(
    `INFO  cleanup: leftover budgets/expenses/departments/users=${leftovers.join('/')}`,
  )
  await mongoose.disconnect()

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('FAILURES:\n' + failures.map((f) => ` - ${f}`).join('\n'))
    process.exitCode = 1
  }
}

async function uiChecks(opts: {
  managerEmail: string
  staffEmail: string
  adminEmail: string
  uiMonth: string
  copyFrom: string
  copyTo: string
  approvedDescription: string
  staffCookie: string
}) {
  // Staff page middleware guard (checked over HTTP, no browser needed).
  const blocked = await api(opts.staffCookie, 'GET', '/budgets')
  check(
    'middleware blocks staff from the /budgets page (403)',
    blocked.status === 403,
    blocked.status,
  )

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []

  // Interacting before hydration makes a controlled input lose its value and
  // a click fall through to a native submit, so wait for React props first.
  const waitHydrated = (page: Page, selector: string) =>
    page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel)
        return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'))
      },
      selector,
      { timeout: 20_000 },
    )

  const newPage = async (email: string) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
    })
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    // Wait for React to hydrate before clicking; an early click does a native
    // form submit that just reloads /login.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('form button[type=submit]')
        return (
          !!btn && Object.keys(btn).some((k) => k.startsWith('__reactProps'))
        )
      },
      undefined,
      { timeout: 20_000 },
    )
    await page.fill('input[id=email]', email)
    await page.fill('input[id=password]', PASS)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 20_000 })
    return page
  }

  try {
    // Manager: create -> edit -> delete a budget through the UI.
    const manager = await newPage(opts.managerEmail)
    await manager.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' })
    await waitHydrated(manager, 'input[id=new-budget-month]')
    check(
      'UI manager sees the budget form and their budgets',
      (await manager.getByRole('heading', { name: /set a budget/i }).count()) >
        0 && (await manager.getByRole('row', { name: /Meals/ }).count()) > 0,
    )

    await manager.fill('input[id=new-budget-month]', opts.uiMonth)
    await manager.selectOption('select[id=new-budget-category]', 'Utilities')
    await manager.fill('input[id=new-budget-amount]', '777')
    await manager.getByRole('button', { name: /set budget/i }).click()
    await manager.waitForURL('**/budgets', { timeout: 15_000 })

    const newRow = manager.getByRole('row', { name: /Utilities/ })
    await newRow.waitFor({ timeout: 15_000 })
    check(
      'UI create shows the new budget row (777.00)',
      (await newRow.textContent())!.includes('777.00') &&
        (await newRow.textContent())!.includes(opts.uiMonth),
      await newRow.textContent(),
    )

    await newRow.getByRole('link', { name: /^edit$/i }).click()
    await manager.waitForURL('**/edit', { timeout: 10_000 })
    const amountBox = manager.locator('input[id=budget-amount]')
    await amountBox.waitFor({ state: 'visible' })
    check(
      'UI edit form is prefilled from the API',
      (await amountBox.inputValue()) === '777',
      await amountBox.inputValue(),
    )
    await amountBox.fill('888')
    await manager.getByRole('button', { name: /save changes/i }).click()
    await manager.waitForURL('**/budgets', { timeout: 15_000 })
    check(
      'UI edit persists the new amount',
      (await manager
        .getByRole('row', { name: /Utilities/ })
        .textContent())!.includes('888.00'),
    )

    manager.on('dialog', (dlg) => dlg.accept())
    await manager
      .getByRole('row', { name: /Utilities/ })
      .getByRole('button', { name: /^delete$/i })
      .click()
    let rowGone = true
    try {
      await manager
        .getByRole('row', { name: /Utilities/ })
        .waitFor({ state: 'detached', timeout: 15_000 })
    } catch {
      rowGone = false
    }
    check('UI delete removes the budget row', rowGone)

    // Phase 7C: copy a month's budgets through the UI.
    await waitHydrated(manager, 'input[id=copy-from-month]')
    await manager.fill('input[id=copy-from-month]', opts.copyFrom)
    await manager.fill('input[id=copy-to-month]', opts.copyTo)
    await manager.getByRole('button', { name: /copy budgets/i }).click()
    let copyToast = true
    try {
      await manager.waitForFunction(
        () => document.body.innerText.includes('Copied'),
        undefined,
        { timeout: 15_000 },
      )
    } catch {
      copyToast = false
    }
    check(
      'UI copy budgets reports how many were created',
      copyToast &&
        (await manager.locator('body').innerText()).includes(
          `Copied 2 budgets to ${opts.copyTo}`,
        ),
      await manager.locator('body').innerText(),
    )

    // Manager: approve a pending expense from the approvals queue.
    await manager.goto(`${BASE}/approvals`, { waitUntil: 'domcontentloaded' })
    await manager
      .getByRole('button', { name: /^approve$/i })
      .first()
      .waitFor()
    const pendingRow = manager.getByRole('row', {
      name: new RegExp(opts.approvedDescription),
    })
    await pendingRow.waitFor({ timeout: 15_000 })
    check(
      'UI approvals queue shows the staff member and amount',
      (await pendingRow.textContent())!.includes('Sam Staff') &&
        (await pendingRow.textContent())!.includes('25.00'),
      await pendingRow.textContent(),
    )
    await pendingRow.getByRole('button', { name: /^approve$/i }).click()
    let approvedGone = true
    try {
      await pendingRow.waitFor({ state: 'detached', timeout: 15_000 })
    } catch {
      approvedGone = false
    }
    check('UI approve clears the row from the queue', approvedGone)

    // Staff: sees the approved status.
    const staff = await newPage(opts.staffEmail)
    await staff.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' })
    const staffRow = staff.getByRole('row', {
      name: new RegExp(opts.approvedDescription),
    })
    await staffRow.waitFor({ timeout: 15_000 })
    check(
      'UI staff sees their expense as approved',
      (await staffRow.textContent())!.includes('approved'),
      await staffRow.textContent(),
    )

    // Admin: read-only budget list.
    const admin = await newPage(opts.adminEmail)
    await admin.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' })
    check(
      'UI admin budget list is read-only',
      (await admin.getByRole('heading', { name: /set a budget/i }).count()) ===
        0 && (await admin.getByRole('link', { name: /^edit$/i }).count()) === 0,
    )

    check('UI: no uncaught page/console errors', errors.length === 0, errors)
  } catch (err) {
    check(`UI flow completed (${(err as Error).message})`, false)
  } finally {
    await browser.close()
  }
}

main().catch(async (err) => {
  console.error('VERIFY ERROR:', err)
  process.exit(1)
})
