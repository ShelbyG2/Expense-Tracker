// Phase 7D (admin and data integrity) end-to-end verification.
//
// Usage: npx tsx scripts/verify-phase7d.mts   (built app must be running)
//
// Creates a throwaway organization and verifies:
//   - the /admin/audit viewer: admin-only, filters (user/entity/action/dates),
//     newest-first ordering and pagination,
//   - department archiving: archived departments keep their name in reports but
//     reject new users/budgets/expenses; unarchive restores them; hard delete
//     stays refused while expenses reference the department,
//   - organization currency: admin-editable, changes page formatting and the
//     CSV/XLSX header labels, and never converts amounts,
//   - the documented email rule on /register and /admin/users.
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
const { summaryReport } = await import('../services/report-service.ts')
const { formatAmount, todayDateOnly } = await import('../lib/format.ts')

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
    /* non-JSON body (pages) */
  }
  return { status: res.status, json, text, headers: res.headers }
}

async function apiBinary(cookie: string, path: string) {
  const res = await fetch(BASE + path, { headers: { cookie } })
  return {
    status: res.status,
    headers: res.headers,
    buffer: Buffer.from(await res.arrayBuffer()),
  }
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

function month(): string {
  return todayDateOnly().slice(0, 7)
}

async function cleanup(orgIds: mongoose.Types.ObjectId[]) {
  if (orgIds.length === 0) return
  await Expense.deleteMany({ organizationId: { $in: orgIds } })
  await Budget.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await Department.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ organizationId: { $in: orgIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })
}

async function main() {
  await connectDB()

  const stale = await Organization.find({ name: /^Phase7D Verify/ })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  if (stale.length) {
    await cleanup(stale.map((o) => o._id))
    console.log(`INFO  removed ${stale.length} stale verify org(s)`)
  }

  // ---------- Fixtures ----------
  const org = await Organization.create({ name: `Phase7D Verify ${runId}` })
  const active = await Department.create({
    organizationId: org._id,
    name: `Active ${runId}`,
  })
  const legacy = await Department.create({
    organizationId: org._id,
    name: `Legacy ${runId}`,
  })
  const legacyId = String(legacy._id)

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

  const admin = await mkUser(
    null,
    'Ada Admin',
    `admin-${runId}@verify.test`,
    'admin',
  )
  await mkUser(
    active._id,
    'Mona Manager',
    `mgr-${runId}@verify.test`,
    'manager',
  )
  const staff = await mkUser(
    active._id,
    'Sam Staff',
    `staff-${runId}@verify.test`,
    'staff',
  )
  const legacyManager = await mkUser(
    legacy._id,
    'Lee Legacy Manager',
    `mgr-legacy-${runId}@verify.test`,
    'manager',
  )
  const legacyStaff = await mkUser(
    legacy._id,
    'Lou Legacy Staff',
    `staff-legacy-${runId}@verify.test`,
    'staff',
  )

  const adminCookie = await login(`admin-${runId}@verify.test`, PASS)
  const managerCookie = await login(`mgr-${runId}@verify.test`, PASS)
  const legacyStaffCookie = await login(
    `staff-legacy-${runId}@verify.test`,
    PASS,
  )
  const legacyManagerCookie = await login(
    `mgr-legacy-${runId}@verify.test`,
    PASS,
  )

  await Budget.create({
    organizationId: org._id,
    departmentId: active._id,
    category: 'Transport',
    amount: 500,
    month: month(),
  })
  await Expense.create({
    organizationId: org._id,
    departmentId: legacy._id,
    userId: legacyStaff._id,
    submitterRole: 'staff',
    category: 'Supplies',
    amount: 700,
    date: new Date(`${todayDateOnly()}T00:00:00.000Z`),
    description: 'Historical legacy spend',
    status: 'approved',
  })

  // ---------- A. Audit viewer ----------
  console.log('\n--- A. Audit log viewer ---')

  // Guarantee enough entries for paging and a Department entity to filter.
  const spare: string[] = []
  for (const suffix of ['C', 'D', 'E']) {
    const res = await api(adminCookie, 'POST', '/api/admin/departments', {
      name: `Spare ${suffix} ${runId}`,
    })
    spare.push((res.json?.department as { id: string } | undefined)?.id ?? '')
  }

  const anonAudit = await api(null, 'GET', '/api/admin/audit')
  const mgrAudit = await api(managerCookie, 'GET', '/api/admin/audit')
  const staffAudit = await api(legacyStaffCookie, 'GET', '/api/admin/audit')
  check(
    'audit API is admin-only (401 anonymous, 403 manager/staff)',
    anonAudit.status === 401 &&
      mgrAudit.status === 403 &&
      staffAudit.status === 403,
    [anonAudit.status, mgrAudit.status, staffAudit.status],
  )

  const auditAll = await api(adminCookie, 'GET', '/api/admin/audit')
  const entries = (auditAll.json?.items ?? []) as {
    userId: string
    userName: string | null
    action: string
    entity: string
    entityId: string
    createdAt: string
  }[]
  const auditTotal = Number(auditAll.json?.total ?? 0)
  check(
    'admin sees the organization audit log with user names',
    auditAll.status === 200 &&
      entries.length >= 3 &&
      entries.every((e) => typeof e.userName === 'string') &&
      entries.some((e) => e.entity === 'Department' && e.action === 'create'),
    entries.slice(0, 3),
  )
  check(
    'audit entries are newest first',
    entries.length >= 2 &&
      Date.parse(entries[0].createdAt) >= Date.parse(entries[1].createdAt),
    entries.slice(0, 2).map((e) => e.createdAt),
  )

  const byEntity = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?entity=Department',
  )
  const entityItems = (byEntity.json?.items ?? []) as { entity: string }[]
  check(
    'filtering by entity returns only that entity',
    byEntity.status === 200 &&
      entityItems.length > 0 &&
      entityItems.every((e) => e.entity === 'Department'),
    entityItems.slice(0, 2),
  )

  const byAction = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?action=create',
  )
  const actionItems = (byAction.json?.items ?? []) as { action: string }[]
  check(
    'filtering by action returns only that action',
    byAction.status === 200 &&
      actionItems.length > 0 &&
      actionItems.every((e) => e.action === 'create'),
    actionItems.slice(0, 2),
  )

  const byUser = await api(
    adminCookie,
    'GET',
    `/api/admin/audit?userId=${String(admin._id)}`,
  )
  const userItems = (byUser.json?.items ?? []) as { userId: string }[]
  check(
    'filtering by user returns only that user’s entries',
    byUser.status === 200 &&
      userItems.length > 0 &&
      userItems.every((e) => e.userId === String(admin._id)),
    userItems.length,
  )

  const emptyRange = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?from=2020-01-01&to=2020-01-02',
  )
  check(
    'a date range with no activity returns an empty page',
    emptyRange.status === 200 &&
      (emptyRange.json?.items as unknown[]).length === 0 &&
      Number(emptyRange.json?.total) === 0,
    emptyRange.json,
  )

  const pageTwo = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?page=2&pageSize=2',
  )
  const pageTwoItems = (pageTwo.json?.items ?? []) as unknown[]
  check(
    'pagination returns page 2 of the requested size',
    pageTwo.status === 200 &&
      Number(pageTwo.json?.page) === 2 &&
      Number(pageTwo.json?.pageSize) === 2 &&
      pageTwoItems.length <= 2 &&
      Number(pageTwo.json?.total) === auditTotal &&
      Number(pageTwo.json?.totalPages) === Math.ceil(auditTotal / 2),
    pageTwo.json,
  )

  const badAction = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?action=archive',
  )
  const badUser = await api(adminCookie, 'GET', '/api/admin/audit?userId=nope')
  const badRange = await api(
    adminCookie,
    'GET',
    '/api/admin/audit?from=2026-10-31&to=2026-10-01',
  )
  const badPage = await api(adminCookie, 'GET', '/api/admin/audit?pageSize=500')
  check(
    'invalid audit filters are 400 (action, user, range, page size)',
    badAction.status === 400 &&
      badUser.status === 400 &&
      badRange.status === 400 &&
      badPage.status === 400,
    [badAction.status, badUser.status, badRange.status, badPage.status],
  )

  const auditPage = await api(adminCookie, 'GET', '/admin/audit')
  const auditPageMgr = await api(managerCookie, 'GET', '/admin/audit')
  check(
    'the audit page renders for admins and is forbidden for managers',
    auditPage.status === 200 &&
      auditPage.text.includes('Audit log') &&
      auditPage.text.includes('Apply filters') &&
      auditPageMgr.status === 403,
    [auditPage.status, auditPageMgr.status],
  )
  check(
    'the admin navigation links to the audit page',
    auditPage.text.includes('href="/admin/audit"'),
  )

  // ---------- B. Department archiving ----------
  console.log('\n--- B. Department archiving ---')

  const archive = await api(
    adminCookie,
    'POST',
    `/api/admin/departments/${legacyId}/archive`,
  )
  const archived = archive.json?.department as
    { isArchived: boolean; archivedAt: string | null } | undefined
  check(
    'admin archives a department (200, flag and timestamp set)',
    archive.status === 200 &&
      archived?.isArchived === true &&
      !!archived?.archivedAt,
    archive.json,
  )

  const archiveAgain = await api(
    adminCookie,
    'POST',
    `/api/admin/departments/${legacyId}/archive`,
  )
  check('archiving twice is a 409', archiveAgain.status === 409)

  const deptList = await api(adminCookie, 'GET', '/api/admin/departments')
  const legacyRow = (
    (deptList.json?.items ?? []) as {
      id: string
      isArchived: boolean
      expenseCount: number
      budgetCount: number
    }[]
  ).find((d) => d.id === legacyId)
  check(
    'the department list reports the archive flag and reference counts',
    deptList.status === 200 &&
      legacyRow?.isArchived === true &&
      legacyRow?.expenseCount === 1 &&
      legacyRow?.budgetCount === 0,
    legacyRow,
  )

  const userIntoArchived = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Blocked User',
    email: `blocked-${runId}@verify.test`,
    password: PASS,
    role: 'staff',
    departmentId: legacyId,
  })
  check(
    'an archived department rejects a new user (400)',
    userIntoArchived.status === 400 &&
      String(userIntoArchived.json?.error).toLowerCase().includes('archived'),
    userIntoArchived.json,
  )

  const budgetIntoArchived = await api(
    legacyManagerCookie,
    'POST',
    '/api/budgets',
    { category: 'Meals', amount: 100, month: month() },
  )
  check(
    'an archived department rejects a new budget (400)',
    budgetIntoArchived.status === 400 &&
      String(budgetIntoArchived.json?.error).toLowerCase().includes('archived'),
    budgetIntoArchived.json,
  )

  const expenseIntoArchived = await api(
    legacyStaffCookie,
    'POST',
    '/api/expenses',
    {
      category: 'Meals',
      amount: 25,
      date: todayDateOnly(),
      description: 'Should be refused',
    },
  )
  check(
    'an archived department rejects a new expense (400)',
    expenseIntoArchived.status === 400 &&
      String(expenseIntoArchived.json?.error)
        .toLowerCase()
        .includes('archived'),
    expenseIntoArchived.json,
  )

  const existingEdit = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${String(legacyStaff._id)}`,
    { name: 'Lou Legacy Staff (edited)' },
  )
  check(
    'members of an archived department can still be edited',
    existingEdit.status === 200,
    existingEdit.json,
  )

  const report = await summaryReport(
    {
      userId: String(admin._id),
      organizationId: String(org._id),
      departmentId: null,
      role: 'admin',
    },
    month(),
  )
  const legacyTotal = report.byDepartment.find(
    (row) => row.departmentId === legacyId,
  )
  check(
    'historical reports keep the archived department’s name and totals',
    !!legacyTotal &&
      legacyTotal.name === `Legacy ${runId}` &&
      legacyTotal.total === 700,
    report.byDepartment,
  )

  const unarchive = await api(
    adminCookie,
    'POST',
    `/api/admin/departments/${legacyId}/unarchive`,
  )
  check(
    'admin unarchives the department (flag cleared)',
    unarchive.status === 200 &&
      (unarchive.json?.department as { isArchived?: boolean } | undefined)
        ?.isArchived === false,
    unarchive.json,
  )

  const expenseAfterUnarchive = await api(
    legacyStaffCookie,
    'POST',
    '/api/expenses',
    {
      category: 'Meals',
      amount: 25,
      date: todayDateOnly(),
      description: 'Allowed again',
    },
  )
  check(
    'an unarchived department accepts new expenses again (201)',
    expenseAfterUnarchive.status === 201,
    expenseAfterUnarchive.json,
  )

  await api(adminCookie, 'POST', `/api/admin/departments/${legacyId}/archive`)

  // A hard delete is refused while an expense references the department.
  await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${String(legacyStaff._id)}`,
    {
      departmentId: null,
    },
  )
  await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${String(legacyManager._id)}`,
    { departmentId: null },
  )
  const deleteWithExpenses = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${legacyId}`,
  )
  check(
    'hard delete is refused while an expense references the department (409)',
    deleteWithExpenses.status === 409 &&
      String(deleteWithExpenses.json?.error).toLowerCase().includes('expense'),
    deleteWithExpenses.json,
  )

  await Expense.deleteMany({
    organizationId: org._id,
    departmentId: legacy._id,
  })
  const deleteEmpty = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${legacyId}`,
  )
  check(
    'hard delete succeeds once nothing references the department',
    deleteEmpty.status === 200,
    deleteEmpty.json,
  )

  const archiveAudit = await AuditLog.exists({
    organizationId: org._id,
    entity: 'Department',
    entityId: legacyId,
    action: 'update',
  })
  check('archiving and unarchiving are audited (rule 7)', !!archiveAudit)

  // ---------- C. Organization currency ----------
  console.log('\n--- C. Organization currency ---')

  // The archived department (and its expense) is gone by now, so give the
  // report a known approved total to format.
  await Expense.create({
    organizationId: org._id,
    departmentId: active._id,
    userId: staff._id,
    submitterRole: 'staff',
    category: 'Supplies',
    amount: 700,
    date: new Date(`${todayDateOnly()}T00:00:00.000Z`),
    description: 'Currency fixture',
    status: 'approved',
  })

  const settingsGet = await api(adminCookie, 'GET', '/api/admin/settings')
  check(
    'the currency defaults to KES',
    settingsGet.status === 200 &&
      (settingsGet.json?.settings as { currency?: string } | undefined)
        ?.currency === 'KES',
    settingsGet.json,
  )

  const setUsd = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    currency: 'usd',
  })
  check(
    'the admin sets a lowercase currency and it is stored uppercase',
    setUsd.status === 200 &&
      (setUsd.json?.settings as { currency?: string } | undefined)?.currency ===
        'USD',
    setUsd.json,
  )
  check(
    'changing the currency leaves the warning threshold untouched',
    (setUsd.json?.settings as { warningThreshold?: number } | undefined)
      ?.warningThreshold === 0.8,
    setUsd.json,
  )

  const badCurrency = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    currency: 'US',
  })
  const injectedSetting = await api(
    adminCookie,
    'PATCH',
    '/api/admin/settings',
    { currency: 'USD', name: 'Hijacked' },
  )
  check(
    'malformed currencies and extra settings are rejected (400)',
    badCurrency.status === 400 && injectedSetting.status === 400,
    [badCurrency.status, injectedSetting.status],
  )

  const usdAmount = formatAmount(700, 'USD')
  const usdBudget = formatAmount(500, 'USD')
  const reportsPage = await api(adminCookie, 'GET', '/reports')
  const budgetsPage = await api(adminCookie, 'GET', '/budgets')
  check(
    'report and budget pages format amounts in the new currency',
    reportsPage.status === 200 &&
      reportsPage.text.includes(usdAmount) &&
      !reportsPage.text.includes('KES ') &&
      budgetsPage.status === 200 &&
      budgetsPage.text.includes(usdBudget) &&
      !budgetsPage.text.includes('KES '),
    { usdAmount, usdBudget },
  )

  const settingsPage = await api(adminCookie, 'GET', '/admin/settings')
  check(
    'the settings page offers the currency field',
    settingsPage.status === 200 && settingsPage.text.includes('Currency'),
    settingsPage.status,
  )

  const csvSummary = await api(
    adminCookie,
    'GET',
    `/api/reports/export?report=summary&month=${month()}`,
  )
  check(
    'CSV headers use the new currency code',
    csvSummary.status === 200 &&
      csvSummary.text.includes('Total approved (USD),700'),
    csvSummary.text.split('\r\n').slice(0, 5),
  )

  const xlsxBudget = await apiBinary(
    adminCookie,
    `/api/reports/export?report=budget&format=xlsx&month=${month()}`,
  )
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBudget.buffer)
  const headerRow = (workbook.worksheets[0].getRow(1).values as unknown[]) ?? []
  check(
    'XLSX headers use the new currency code',
    xlsxBudget.status === 200 && headerRow.includes('Budget (USD)'),
    headerRow,
  )

  const currencyAudit = await AuditLog.exists({
    organizationId: org._id,
    entity: 'Organization',
    action: 'update',
  })
  check('changing the currency is audited (rule 7)', !!currencyAudit)

  const resetCurrency = await api(adminCookie, 'PATCH', '/api/admin/settings', {
    currency: 'KES',
  })
  check(
    'resetting the currency back to KES works',
    resetCurrency.status === 200 &&
      (resetCurrency.json?.settings as { currency?: string } | undefined)
        ?.currency === 'KES',
    resetCurrency.json,
  )

  // ---------- D. Email rule documentation ----------
  console.log('\n--- D. Email rule ---')

  const registerPage = await api(null, 'GET', '/register')
  const usersPage = await api(adminCookie, 'GET', '/admin/users')
  check(
    'the register form documents the one-organization email rule',
    registerPage.status === 200 &&
      registerPage.text.includes('belongs to one organization'),
    registerPage.status,
  )
  check(
    'the admin user form documents the one-organization email rule',
    usersPage.status === 200 &&
      usersPage.text.includes('belongs to one organization'),
    usersPage.status,
  )

  // ---------- Cleanup ----------
  // The spare departments have no references beyond their creation audits.
  for (const id of spare.filter(Boolean)) {
    await api(adminCookie, 'DELETE', `/api/admin/departments/${id}`)
  }
  await cleanup([org._id])
  await mongoose.disconnect()

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.log(`Failed checks:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
}

await main()
