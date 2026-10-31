// Phase 4 (Processing and outputs) end-to-end verification against the master
// prompt.
//
// Usage: npx tsx scripts/verify-phase4.mts   (dev server must be running)
//
// Creates a throwaway organization with two departments plus a second
// organization for an isolation check, then inserts expense/budget fixtures
// with hand-computable totals:
//
//   Dept A, current month: budgets Transport 1000 / Meals 500 / Supplies 200
//   approved Transport 750 (75% -> ok), pending Transport 100 (awaiting),
//   approved Meals 400 (80% -> warning), rejected Meals 999 (ignored),
//   approved Supplies 250 (125% -> exceeded)  => total approved 1400
//   Dept A, months -5..-1: approved 10/20/30/40/50 (trend line)
//   Dept B: approved Transport 100, budget 300 (33.3% -> ok); previous month
//   has budgets Transport 400 / Meals 100 and approved Transport 999, so the
//   carryOver flags clamp to 0 and carry in 100 respectively (Phase 7C)
//   Dept A previous month: approved Transport 50 with no budget -> unbudgeted
//   Other org: approved 999 (must never leak into our numbers)
//
// The report service, CSV export route, /reports page and dashboards are all
// asserted against those exact figures. Fixtures are removed at the end.

import { loadEnvFile } from 'node:process'
import mongoose from 'mongoose'

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
const { summaryReport, budgetVsActual, spendingTrends, budgetAlerts } =
  await import('../services/report-service.ts')
const { formatAmount } = await import('../lib/format.ts')

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
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON body (e.g. a CSV export or the 403 page from middleware) */
  }
  return { status: res.status, json, text, headers: res.headers }
}

// Binary variant for the Phase 7C XLSX downloads.
async function apiBinary(cookie: string | null, path: string) {
  const res = await fetch(BASE + path, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  })
  const buffer = Buffer.from(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, buffer }
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

// Local calendar month (matches lib/format's currentMonth).
function month(offset = 0): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// A date inside the given month: day 1 is never in the future when the month
// is the current one, day 15 is safe for past months.
function inMonth(monthStr: string, day = 1): string {
  return `${monthStr}-${String(day).padStart(2, '0')}`
}

async function main() {
  await connectDB()

  // Remove fixtures from an interrupted earlier run (only this script creates
  // organizations with this prefix).
  const stale = await Organization.find({ name: /^Phase4 Verify/ })
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

  // ---------- Fixtures ----------
  const orgV = await Organization.create({ name: `Phase4 Verify ${runId}` })
  const orgOther = await Organization.create({
    name: `Phase4 Verify Other ${runId}`,
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
    organizationId: orgOther._id,
    name: `Other Dept ${runId}`,
  })
  const deptAName = `Dept A ${runId}`
  const deptBName = `Dept B ${runId}`
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

  const admin = await mkUser(
    orgV._id,
    null,
    'Ada Admin',
    `admin-${runId}@verify.test`,
    'admin',
  )
  const mgrA = await mkUser(
    orgV._id,
    deptA._id,
    'Mona Manager',
    `mgr-a-${runId}@verify.test`,
    'manager',
  )
  const staffA1 = await mkUser(
    orgV._id,
    deptA._id,
    'Sam Staff',
    `staff-a1-${runId}@verify.test`,
    'staff',
  )
  const staffA2 = await mkUser(
    orgV._id,
    deptA._id,
    'Sara Staff',
    `staff-a2-${runId}@verify.test`,
    'staff',
  )
  const mgrB = await mkUser(
    orgV._id,
    deptB._id,
    'Mo Manager',
    `mgr-b-${runId}@verify.test`,
    'manager',
  )
  const staffB = await mkUser(
    orgV._id,
    deptB._id,
    'Bo Staff',
    `staff-b-${runId}@verify.test`,
    'staff',
  )
  const mgrOther = await mkUser(
    orgOther._id,
    deptOther._id,
    'Otto Other',
    `mgr-other-${runId}@verify.test`,
    'manager',
  )

  const M0 = month(0)
  const M_PREV = month(-1)

  const mkExpense = (
    user: { _id: unknown },
    dept: { _id: unknown } | null,
    org: { _id: unknown },
    fields: {
      category: string
      amount: number
      date: string
      status: 'pending' | 'approved' | 'rejected'
      description?: string
    },
  ) =>
    Expense.create({
      organizationId: org._id,
      departmentId: dept ? dept._id : null,
      userId: user._id,
      description: '',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      ...fields,
    })

  // Dept A, current month (the numbers every check below relies on).
  await mkExpense(staffA1, deptA, orgV, {
    category: 'Transport',
    amount: 750,
    date: inMonth(M0),
    status: 'approved',
  })
  await mkExpense(staffA2, deptA, orgV, {
    category: 'Transport',
    amount: 100,
    date: inMonth(M0),
    status: 'pending',
  })
  await mkExpense(staffA1, deptA, orgV, {
    category: 'Meals',
    amount: 400,
    date: inMonth(M0),
    status: 'approved',
  })
  await mkExpense(staffA2, deptA, orgV, {
    category: 'Meals',
    amount: 999,
    date: inMonth(M0),
    status: 'rejected',
  })
  await mkExpense(staffA1, deptA, orgV, {
    category: 'Supplies',
    amount: 250,
    date: inMonth(M0),
    status: 'approved',
  })

  // Dept A, past months -> trend line 10/20/30/40/50.
  const pastAmounts = [10, 20, 30, 40, 50] // oldest first: -5 .. -1
  for (let i = 0; i < pastAmounts.length; i++) {
    await mkExpense(staffA1, deptA, orgV, {
      category: 'Transport',
      amount: pastAmounts[i],
      date: inMonth(month(-5 + i), 15),
      status: 'approved',
    })
  }
  // Decoys that must never count toward spending totals.
  await mkExpense(staffA1, deptA, orgV, {
    category: 'Events',
    amount: 77,
    date: inMonth(month(-2), 15),
    status: 'pending',
  })
  await mkExpense(staffA1, deptA, orgV, {
    category: 'Events',
    amount: 55,
    date: inMonth(month(-3), 15),
    status: 'rejected',
  })

  // Dept B.
  await mkExpense(staffB, deptB, orgV, {
    category: 'Transport',
    amount: 100,
    date: inMonth(M0),
    status: 'approved',
  })
  await mkExpense(staffB, deptB, orgV, {
    category: 'Transport',
    amount: 999,
    date: inMonth(month(-1), 15),
    status: 'approved',
  })

  // Other organization.
  await mkExpense(mgrOther, deptOther, orgOther, {
    category: 'Transport',
    amount: 999,
    date: inMonth(M0),
    status: 'approved',
  })

  // Budgets.
  const mkBudget = (
    dept: { _id: unknown },
    category: string,
    amount: number,
    m = M0,
    carryOver = false,
  ) =>
    Budget.create({
      organizationId: orgV._id,
      departmentId: dept._id,
      category,
      amount,
      month: m,
      carryOver,
    })
  await mkBudget(deptA, 'Transport', 1000)
  await mkBudget(deptA, 'Meals', 500)
  await mkBudget(deptA, 'Supplies', 200)
  await mkBudget(deptB, 'Transport', 300, M0, true)
  // Previous month for the rollover fixtures (Phase 7C).
  await mkBudget(deptB, 'Transport', 400, M_PREV)
  await mkBudget(deptB, 'Meals', 100, M_PREV)
  await mkBudget(deptB, 'Meals', 100, M0, true)

  // Sessions derived exactly like the app derives them (from the verified
  // session, never from client input).
  const sMgrA = {
    userId: String(mgrA._id),
    organizationId: String(orgV._id),
    departmentId: String(deptA._id),
    role: 'manager' as const,
  }
  const sStaffA = {
    userId: String(staffA1._id),
    organizationId: String(orgV._id),
    departmentId: String(deptA._id),
    role: 'staff' as const,
  }
  const sAdmin = {
    userId: String(admin._id),
    organizationId: String(orgV._id),
    departmentId: null,
    role: 'admin' as const,
  }
  const sMgrB = {
    userId: String(mgrB._id),
    organizationId: String(orgV._id),
    departmentId: String(deptB._id),
    role: 'manager' as const,
  }
  const sMgrOther = {
    userId: String(mgrOther._id),
    organizationId: String(orgOther._id),
    departmentId: String(deptOther._id),
    role: 'manager' as const,
  }

  // ---------- Service-level checks (exact numbers) ----------
  const summaryA = await summaryReport(sMgrA, M0)
  check(
    'summary: manager total approved is exactly 1400',
    summaryA.totalApproved === 1400,
    summaryA.totalApproved,
  )
  check(
    'summary: pending 100 is reported separately as awaiting approval (rule 5)',
    summaryA.awaitingApproval === 100,
    summaryA.awaitingApproval,
  )
  check(
    'summary: category split matches, zero-filled in the fixed CATEGORIES order',
    summaryA.byCategory.map((r) => `${r.category}:${r.total}`).join(',') ===
      'Transport:750,Supplies:250,Meals:400,Utilities:0,Events:0,Other:0',
    summaryA.byCategory,
  )
  check(
    'summary: department split holds only the manager’s own department',
    summaryA.byDepartment.length === 1 &&
      summaryA.byDepartment[0].name === deptAName &&
      summaryA.byDepartment[0].total === 1400,
    summaryA.byDepartment,
  )
  check(
    'summary: rejected (999) and pending (100) never reach the approved total',
    summaryA.totalApproved === 1400,
    summaryA.totalApproved,
  )

  const summaryAdmin = await summaryReport(sAdmin, M0)
  check(
    'summary: admin sees the whole organization (1400 + 100 = 1500)',
    summaryAdmin.totalApproved === 1500,
    summaryAdmin.totalApproved,
  )
  check(
    'summary: admin department split is exact and name-sorted',
    summaryAdmin.byDepartment.map((r) => `${r.name}:${r.total}`).join(',') ===
      `${deptAName}:1400,${deptBName}:100`,
    summaryAdmin.byDepartment,
  )

  const summaryStaff = await summaryReport(sStaffA, M0)
  check(
    'summary: staff sees their department’s totals (roles section)',
    summaryStaff.totalApproved === 1400 &&
      summaryStaff.awaitingApproval === 100,
    summaryStaff.totalApproved,
  )

  const summaryOther = await summaryReport(sMgrOther, M0)
  check(
    'summary: another organization sees only its own 999 (rule 1)',
    summaryOther.totalApproved === 999,
    summaryOther.totalApproved,
  )

  const rowsA = await budgetVsActual(sMgrA, M0)
  check(
    'budget vs actual: 3 rows in the fixed CATEGORIES order',
    rowsA.length === 3 &&
      rowsA.map((r) => r.category).join(',') === 'Transport,Supplies,Meals',
    rowsA.map((r) => r.category),
  )
  check(
    'budget vs actual: Transport 750/1000 = 75% -> ok, 100 awaiting',
    rowsA[0]?.budget === 1000 &&
      rowsA[0]?.spent === 750 &&
      rowsA[0]?.remaining === 250 &&
      rowsA[0]?.percentUsed === 0.75 &&
      rowsA[0]?.status === 'ok' &&
      rowsA[0]?.awaitingApproval === 100,
    rowsA[0],
  )
  check(
    'budget vs actual: Supplies 250/200 = 125% -> exceeded',
    rowsA[1]?.budget === 200 &&
      rowsA[1]?.spent === 250 &&
      rowsA[1]?.remaining === -50 &&
      rowsA[1]?.percentUsed === 1.25 &&
      rowsA[1]?.status === 'exceeded' &&
      rowsA[1]?.awaitingApproval === 0,
    rowsA[1],
  )
  check(
    'budget vs actual: Meals 400/500 = exactly 80% -> warning (rule 6)',
    rowsA[2]?.budget === 500 &&
      rowsA[2]?.spent === 400 &&
      rowsA[2]?.remaining === 100 &&
      rowsA[2]?.percentUsed === 0.8 &&
      rowsA[2]?.status === 'warning' &&
      rowsA[2]?.awaitingApproval === 0,
    rowsA[2],
  )

  const rowsStaff = await budgetVsActual(sStaffA, M0)
  check(
    'budget vs actual: staff sees the same department rows (read-only)',
    JSON.stringify(rowsStaff) === JSON.stringify(rowsA),
    rowsStaff,
  )

  const rowsAdmin = await budgetVsActual(sAdmin, M0)
  check(
    'budget vs actual: admin sees both departments (5 rows)',
    rowsAdmin.length === 5 &&
      rowsAdmin.some(
        (r) =>
          r.departmentName === deptBName &&
          r.category === 'Transport' &&
          r.budget === 300 &&
          r.spent === 100 &&
          r.status === 'ok',
      ),
    rowsAdmin,
  )

  const rowsB = await budgetVsActual(sMgrB, M0)
  check(
    'budget vs actual: manager B sees only their two department budgets',
    rowsB.length === 2 && rowsB.every((r) => r.departmentName === deptBName),
    rowsB,
  )
  check(
    'carry-over: an overspent previous month carries nothing (clamped at 0)',
    rowsB[0].category === 'Transport' &&
      rowsB[0].budget === 300 &&
      rowsB[0].carriedOver === 0 &&
      rowsB[0].available === 300 &&
      rowsB[0].remaining === 200 &&
      rowsB[0].status === 'ok',
    rowsB[0],
  )
  check(
    'carry-over: 100 unspent from last month raises the available budget to 200',
    rowsB[1].category === 'Meals' &&
      rowsB[1].budget === 100 &&
      rowsB[1].carriedOver === 100 &&
      rowsB[1].available === 200 &&
      rowsB[1].spent === 0 &&
      rowsB[1].remaining === 200 &&
      rowsB[1].percentUsed === 0 &&
      rowsB[1].status === 'ok',
    rowsB[1],
  )

  // Phase 7C: approved spending with no budget shows as unbudgeted. Dept A's
  // previous month has 50 approved and no budgets at all.
  const rowsPrevA = await budgetVsActual(sMgrA, M_PREV)
  check(
    'unbudgeted: the previous month returns one unbudgeted row (50 spent)',
    rowsPrevA.length === 1 &&
      rowsPrevA[0].category === 'Transport' &&
      rowsPrevA[0].budget === null &&
      rowsPrevA[0].available === null &&
      rowsPrevA[0].remaining === null &&
      rowsPrevA[0].percentUsed === null &&
      rowsPrevA[0].spent === 50 &&
      rowsPrevA[0].status === 'unbudgeted',
    rowsPrevA,
  )
  const alertsPrevA = await budgetAlerts(sMgrA, M_PREV)
  check(
    'alerts include the unbudgeted row',
    alertsPrevA.length === 1 && alertsPrevA[0].status === 'unbudgeted',
    alertsPrevA.map((r) => `${r.category}:${r.status}`),
  )

  const rowsPrevAdmin = await budgetVsActual(sAdmin, M_PREV)
  check(
    'unbudgeted + budgeted rows coexist for the admin (3 rows)',
    rowsPrevAdmin.length === 3 &&
      rowsPrevAdmin.some((r) => r.status === 'unbudgeted') &&
      rowsPrevAdmin.some(
        (r) =>
          r.category === 'Transport' &&
          r.departmentName === deptBName &&
          r.budget === 400 &&
          r.spent === 999 &&
          r.status === 'exceeded',
      ),
    rowsPrevAdmin,
  )

  const alertsA = await budgetAlerts(sMgrA, M0)
  check(
    'alerts: warning + exceeded rows only, worst first',
    alertsA.length === 2 &&
      alertsA[0].category === 'Supplies' &&
      alertsA[0].status === 'exceeded' &&
      alertsA[1].category === 'Meals' &&
      alertsA[1].status === 'warning',
    alertsA.map((r) => `${r.category}:${r.status}`),
  )
  const alertsB = await budgetAlerts(sMgrB, M0)
  check('alerts: 33% used produces no alert', alertsB.length === 0, alertsB)

  const trendsA = await spendingTrends(sMgrA)
  const expectedTrends = [10, 20, 30, 40, 50, 1400].map((total, i) => ({
    month: month(-5 + i),
    total,
  }))
  check(
    'trends: exactly 6 months with the fixture totals',
    trendsA.length === 6 &&
      JSON.stringify(trendsA) === JSON.stringify(expectedTrends),
    trendsA,
  )
  const trendsAdmin = await spendingTrends(sAdmin)
  const prevMonthTotal = trendsAdmin.find((p) => p.month === M_PREV)?.total
  check(
    'trends: admin totals include the other department (50 + 999 = 1049)',
    prevMonthTotal === 1049,
    prevMonthTotal,
  )

  // ---------- HTTP checks: CSV export ----------
  const mgrCookie = await login(`mgr-a-${runId}@verify.test`, PASS)
  const staffCookie = await login(`staff-a1-${runId}@verify.test`, PASS)
  const adminCookie = await login(`admin-${runId}@verify.test`, PASS)

  const csvSum = await api(
    mgrCookie,
    'GET',
    `/api/reports/export?report=summary&month=${M0}`,
  )
  check(
    'CSV summary: 200, text/csv, download filename',
    csvSum.status === 200 &&
      (csvSum.headers.get('content-type') ?? '').startsWith('text/csv') &&
      (csvSum.headers.get('content-disposition') ?? '').includes(
        `expense-summary-${M0}.csv`,
      ),
    [csvSum.status, csvSum.headers.get('content-disposition')],
  )
  check(
    'CSV summary: totals match the fixtures exactly',
    csvSum.text.includes(`Total approved (KES),1400\r\n`) &&
      csvSum.text.includes(`Awaiting approval (KES),100\r\n`) &&
      csvSum.text.includes(`Transport,750\r\n`) &&
      csvSum.text.includes(`Meals,400\r\n`) &&
      csvSum.text.includes(`Supplies,250\r\n`) &&
      csvSum.text.includes(`${deptAName},1400\r\n`),
    csvSum.text,
  )

  const csvBudget = await api(
    mgrCookie,
    'GET',
    `/api/reports/export?report=budget&month=${M0}`,
  )
  check(
    'CSV budget: header carries the carry-over and available columns (Phase 7C)',
    csvBudget.status === 200 &&
      csvBudget.text.startsWith(
        'Department,Category,Budget (KES),Carried over (KES),Available (KES),Spent (KES),Remaining (KES),Percent used,Status,Awaiting approval (KES)',
      ),
    csvBudget.text.split('\r\n')[0],
  )
  check(
    'CSV budget: every row matches exactly (ok/warning/exceeded)',
    csvBudget.status === 200 &&
      csvBudget.text.includes(
        `${deptAName},Transport,1000,0,1000,750,250,75,ok,100\r\n`,
      ) &&
      csvBudget.text.includes(
        `${deptAName},Meals,500,0,500,400,100,80,warning,0\r\n`,
      ) &&
      csvBudget.text.includes(
        `${deptAName},Supplies,200,0,200,250,-50,125,exceeded,0\r\n`,
      ),
    csvBudget.text,
  )

  const csvAdmin = await api(
    adminCookie,
    'GET',
    `/api/reports/export?report=budget&month=${M0}`,
  )
  check(
    'CSV budget: admin export includes the other department and the carried amount',
    csvAdmin.status === 200 &&
      csvAdmin.text.includes(
        `${deptBName},Transport,300,0,300,100,200,33.3,ok,0\r\n`,
      ) &&
      csvAdmin.text.includes(`${deptBName},Meals,100,100,200,0,200,0,ok,0\r\n`),
    csvAdmin.text,
  )

  const csvUnbudgeted = await api(
    adminCookie,
    'GET',
    `/api/reports/export?report=budget&month=${M_PREV}`,
  )
  check(
    'CSV budget: an unbudgeted row leaves the budget figures empty',
    csvUnbudgeted.status === 200 &&
      csvUnbudgeted.text.includes(
        `${deptAName},Transport,,0,,50,,,unbudgeted,0\r\n`,
      ),
    csvUnbudgeted.text,
  )

  const csvDefaultMonth = await api(
    mgrCookie,
    'GET',
    '/api/reports/export?report=summary',
  )
  check(
    'CSV export without month defaults to the current month',
    csvDefaultMonth.status === 200 &&
      csvDefaultMonth.text.includes('Total approved (KES),1400'),
    csvDefaultMonth.status,
  )

  const csvStaff = await api(
    staffCookie,
    'GET',
    '/api/reports/export?report=summary',
  )
  check('CSV export is forbidden for staff (403)', csvStaff.status === 403)

  const csvAnon = await api(null, 'GET', '/api/reports/export?report=summary')
  check('CSV export requires a session (401)', csvAnon.status === 401)

  const csvBadReport = await api(
    mgrCookie,
    'GET',
    '/api/reports/export?report=everything',
  )
  check(
    'CSV export rejects an unknown report name (400)',
    csvBadReport.status === 400,
    csvBadReport.json,
  )

  const csvBadMonth = await api(
    mgrCookie,
    'GET',
    '/api/reports/export?report=summary&month=1342-99',
  )
  check('CSV export rejects an invalid month (400)', csvBadMonth.status === 400)

  const csvBadFormat = await api(
    mgrCookie,
    'GET',
    '/api/reports/export?report=summary&format=pdf',
  )
  check('export rejects an unknown format (400)', csvBadFormat.status === 400)

  // ---------- XLSX export (Phase 7C) ----------
  const xlsxSummary = await apiBinary(
    mgrCookie,
    `/api/reports/export?report=summary&format=xlsx&month=${M0}`,
  )
  check(
    'XLSX summary: 200, spreadsheet content type, .xlsx filename',
    xlsxSummary.status === 200 &&
      (xlsxSummary.headers.get('content-type') ?? '') ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      (xlsxSummary.headers.get('content-disposition') ?? '').includes(
        `expense-summary-${M0}.xlsx`,
      ),
    [xlsxSummary.status, xlsxSummary.headers.get('content-disposition')],
  )
  check(
    'XLSX summary: a real zip container, not HTML',
    xlsxSummary.buffer.subarray(0, 2).toString() === 'PK' &&
      xlsxSummary.buffer.length > 1000,
    xlsxSummary.buffer.length,
  )

  const xlsxBudget = await apiBinary(
    adminCookie,
    `/api/reports/export?report=budget&format=xlsx&month=${M_PREV}`,
  )
  check(
    'XLSX budget: 200 with the month in the filename',
    xlsxBudget.status === 200 &&
      (xlsxBudget.headers.get('content-disposition') ?? '').includes(
        `expense-budget-${M_PREV}.xlsx`,
      ),
    xlsxBudget.status,
  )

  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBudget.buffer)
  const sheet = workbook.worksheets[0]
  const sheetValues = (sheet.getSheetValues() as unknown[][])
    .flat()
    .map((value) => (value == null ? '' : String(value)))
    .join('|')
  check(
    'XLSX budget: the sheet carries the unbudgeted row and its 50 spend',
    sheet.name.includes(M_PREV) &&
      sheetValues.includes(deptAName) &&
      sheetValues.includes('unbudgeted') &&
      sheetValues.includes('50'),
    { sheet: sheet.name, sample: sheetValues.slice(0, 200) },
  )

  // ---------- Organization settings (Phase 7C) ----------
  const settingsGet = await api(adminCookie, 'GET', '/api/admin/settings')
  const settingsValue = (
    settingsGet.json?.settings as { warningThreshold?: number } | undefined
  )?.warningThreshold
  check(
    'settings: the warning threshold defaults to 0.8',
    settingsGet.status === 200 && settingsValue === 0.8,
    settingsGet.json,
  )

  const settingsMgr = await api(mgrCookie, 'GET', '/api/admin/settings')
  const settingsStaff = await api(staffCookie, 'GET', '/api/admin/settings')
  check(
    'settings API is admin-only (403 for manager and staff)',
    settingsMgr.status === 403 && settingsStaff.status === 403,
    [settingsMgr.status, settingsStaff.status],
  )

  const tighten = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    warningThreshold: 0.5,
  })
  check(
    'the admin lowers the warning threshold to 0.5',
    tighten.status === 200 &&
      (tighten.json?.settings as { warningThreshold?: number } | undefined)
        ?.warningThreshold === 0.5,
    tighten.json,
  )

  const rowsTight = await budgetVsActual(sMgrA, M0)
  const tightByCategory = new Map(rowsTight.map((row) => [row.category, row]))
  check(
    'the 50% threshold turns the 75% row into a warning (80% was already one)',
    tightByCategory.get('Transport')?.status === 'warning' &&
      tightByCategory.get('Meals')?.status === 'warning' &&
      tightByCategory.get('Supplies')?.status === 'exceeded',
    rowsTight.map((r) => `${r.category}:${r.status}`),
  )

  const tooLow = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    warningThreshold: 0.4,
  })
  const tooHigh = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    warningThreshold: 0.96,
  })
  const settingsInjection = await api(
    adminCookie,
    'PATCH',
    '/api/admin/settings',
    { warningThreshold: 0.8, name: 'Hacked' },
  )
  check(
    'settings reject thresholds outside 0.5–0.95 and extra fields (400)',
    tooLow.status === 400 &&
      tooHigh.status === 400 &&
      settingsInjection.status === 400,
    [tooLow.status, tooHigh.status, settingsInjection.status],
  )

  const settingsAudit = await AuditLog.exists({
    organizationId: orgV._id,
    entity: 'Organization',
    action: 'update',
  })
  check('changing a setting writes an audit entry (rule 7)', !!settingsAudit)

  const settingsPage = await api(adminCookie, 'GET', '/admin/settings')
  check(
    'the admin settings page renders the threshold form',
    settingsPage.status === 200 &&
      settingsPage.text.includes('Warning threshold') &&
      settingsPage.text.includes('Save settings'),
    settingsPage.status,
  )
  const settingsPageMgr = await api(mgrCookie, 'GET', '/admin/settings')
  check(
    'the settings page is forbidden for managers (403)',
    settingsPageMgr.status === 403,
    settingsPageMgr.status,
  )

  const reset = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    warningThreshold: 0.8,
  })
  check(
    'resetting the threshold to 0.8 restores the default classification',
    reset.status === 200 &&
      (await budgetAlerts(sMgrA, M0)).map((r) => r.status).join(',') ===
        'exceeded,warning',
    reset.json,
  )

  // ---------- HTTP checks: pages ----------
  const repMgr = await api(mgrCookie, 'GET', '/reports')
  check('reports page renders for the manager (200)', repMgr.status === 200)
  check(
    'reports page shows the budget vs actual figures and statuses',
    repMgr.text.includes('Budget vs actual') &&
      repMgr.text.includes('750.00') &&
      repMgr.text.includes('125.0%') &&
      repMgr.text.includes('Exceeded') &&
      repMgr.text.includes('Awaiting approval'),
    repMgr.text.slice(0, 400),
  )

  const repStaff = await api(staffCookie, 'GET', '/reports')
  check('reports page is blocked for staff (403)', repStaff.status === 403)

  const repAdmin = await api(adminCookie, 'GET', '/reports')
  check(
    'reports page shows both departments to the admin',
    repAdmin.status === 200 &&
      repAdmin.text.includes(deptBName) &&
      repAdmin.text.includes('300.00'),
  )

  const repBadMonth = await api(mgrCookie, 'GET', '/reports?month=1342-99')
  check(
    'reports page falls back with a notice on an invalid month',
    repBadMonth.status === 200 && repBadMonth.text.includes('not valid'),
    repBadMonth.status,
  )

  const dashMgr = await api(mgrCookie, 'GET', '/dashboard')
  check(
    'manager dashboard lists the alerts with exact percentages',
    dashMgr.status === 200 &&
      dashMgr.text.includes('2 categories need attention') &&
      dashMgr.text.includes('Supplies') &&
      dashMgr.text.includes('125.0%') &&
      dashMgr.text.includes('Adjust budgets'),
    dashMgr.text.slice(0, 400),
  )

  const dashStaff = await api(staffCookie, 'GET', '/dashboard')
  check(
    'staff dashboard shows the department budget status',
    dashStaff.status === 200 &&
      dashStaff.text.includes('Department budget status') &&
      dashStaff.text.includes('750.00'),
  )

  const dashAdmin = await api(adminCookie, 'GET', '/dashboard')
  check(
    'admin dashboard carries no manager alert banner',
    dashAdmin.status === 200 && !dashAdmin.text.includes('need attention'),
  )

  // ---------- UI flow ----------
  await uiChecks({
    managerEmail: `mgr-a-${runId}@verify.test`,
    staffEmail: `staff-a1-${runId}@verify.test`,
    adminEmail: `admin-${runId}@verify.test`,
    deptBName,
    currentMonth: M0,
    previousMonth: M_PREV,
  })

  // ---------- Cleanup ----------
  const orgIds = [orgV._id, orgOther._id]
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
  deptBName: string
  currentMonth: string
  previousMonth: string
}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []

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
    // Manager: the reports page shows exact figures, statuses and charts.
    const manager = await newPage(opts.managerEmail)
    await manager.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await manager.locator('table').first().waitFor({ timeout: 20_000 })

    const tableText = await manager.locator('table').first().innerText()
    check(
      'UI budget vs actual table matches the fixtures',
      tableText.includes('Transport') &&
        tableText.includes(formatAmount(1000, 'KES')) &&
        tableText.includes(formatAmount(750, 'KES')) &&
        tableText.includes('75.0%') &&
        tableText.includes('Warning') &&
        tableText.includes('Exceeded') &&
        tableText.includes(formatAmount(-50, 'KES')),
      tableText,
    )
    check(
      'UI table exposes the carry-over and available columns (Phase 7C)',
      /carried over/i.test(tableText) && /available/i.test(tableText),
      tableText,
    )

    // Charts mount after layout; wait for the recharts SVG surface, then
    // count the series elements (class names live on the path/rect, not the
    // svg itself).
    const charts = manager.locator('.recharts-surface')
    try {
      await charts.first().waitFor({ timeout: 15_000 })
    } catch {
      /* counted below; empty states are reported in the detail */
    }
    const lineCount = await manager.locator('.recharts-line-curve').count()
    // recharts skips zero-dimension bars, so only the categories with
    // spending draw rectangles — any bar proves the chart rendered.
    const barCount = await manager.locator('.recharts-bar-rectangle').count()
    const chartOk = lineCount > 0 && barCount >= 1
    check(
      'UI renders the 6-month line chart and the category bar chart',
      chartOk,
      chartOk
        ? [lineCount, barCount]
        : {
            lineCount,
            barCount,
            surfaces: await manager.evaluate(() =>
              [...document.querySelectorAll('.recharts-surface')].map((s) =>
                s.outerHTML.slice(0, 500),
              ),
            ),
          },
    )

    // Switch months through the GET form.
    await manager.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel)
        return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'))
      },
      'input[id=report-month]',
      { timeout: 20_000 },
    )
    await manager.fill('input[id=report-month]', opts.previousMonth)
    await manager.getByRole('button', { name: /^apply$/i }).click()
    await manager.waitForURL(`**/reports?month=${opts.previousMonth}`, {
      timeout: 20_000,
    })
    await manager.waitForFunction(
      (label) => document.body.innerText.includes(label),
      `Total approved — ${opts.previousMonth}`,
      { timeout: 20_000 },
    )
    const prevBody = await manager.locator('body').innerText()
    check(
      'UI month switch shows the previous month (50.00 approved, unbudgeted)',
      prevBody.includes('50.00') &&
        prevBody.includes('No budget') &&
        prevBody.includes(`Total approved — ${opts.previousMonth}`),
      prevBody.slice(0, 400),
    )

    // Phase 7C print stylesheet: Print > Save as PDF hides the chrome but keeps
    // the charts.
    await manager.emulateMedia({ media: 'print' })
    // No named helpers inside evaluate: the tsx transform injects a `__name`
    // helper that does not exist in the browser context.
    const printState = await manager.evaluate(() => {
      const header = document.querySelector('header')
      const filter = document.querySelector('form[action="/reports"]')
      return {
        header: header ? getComputedStyle(header).display : null,
        filter: filter ? getComputedStyle(filter).display : null,
        charts: document.querySelectorAll('.recharts-surface').length,
      }
    })
    await manager.emulateMedia({ media: 'screen' })
    check(
      'UI print stylesheet hides the navigation and filters, keeps the charts',
      printState.header === 'none' &&
        printState.filter === 'none' &&
        printState.charts > 0,
      printState,
    )

    // Manager dashboard: alerts banner.
    await manager.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    const banner = manager.locator('[aria-label="Budget alerts"]')
    await banner.waitFor({ timeout: 20_000 })
    const bannerText = await banner.innerText()
    check(
      'UI dashboard alert banner lists both categories with percentages',
      bannerText.includes('2 categories need attention') &&
        bannerText.includes('Supplies') &&
        bannerText.includes('125.0%') &&
        bannerText.includes('Meals') &&
        bannerText.includes('80.0%'),
      bannerText,
    )

    // Staff: read-only department budget status, no Reports nav link.
    const staff = await newPage(opts.staffEmail)
    await staff.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    await staff.locator('table').first().waitFor({ timeout: 20_000 })
    const staffTable = await staff.locator('table').first().innerText()
    check(
      'UI staff dashboard shows the department budget status',
      staffTable.includes('Transport') &&
        staffTable.includes('750.00') &&
        staffTable.includes('100.00') &&
        // The header is CSS-uppercased, so innerText yields "AWAITING".
        /awaiting/i.test(staffTable),
      staffTable,
    )
    check(
      'UI staff navigation has no Reports link',
      (await staff.getByRole('link', { name: /^reports$/i }).count()) === 0,
    )

    // Admin: reports cover both departments.
    const admin = await newPage(opts.adminEmail)
    await admin.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await admin.locator('table').first().waitFor({ timeout: 20_000 })
    const adminTable = await admin.locator('table').first().innerText()
    check(
      'UI admin budget table includes both departments and the carried amount',
      adminTable.includes(opts.deptBName) &&
        adminTable.includes('300.00') &&
        adminTable.includes('100.00') &&
        adminTable.includes('200.00') &&
        /carried over/i.test(adminTable),
      adminTable,
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
