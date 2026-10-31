// Phase 5 (Admin and polish) end-to-end verification against the master
// prompt.
//
// Usage: npx tsx scripts/verify-phase5.mts   (dev server must be running)
//
// Creates a throwaway organization (plus a second one for isolation checks)
// and verifies:
//   - admin API access control (401/403), user CRUD, role/department
//     assignment, deactivate/reactivate, self-lockout guards,
//   - department CRUD with reference guards (users and budgets block delete),
//   - audit rows for user/department create/update/delete (rule 7),
//   - security headers (CSP, nosniff, frame options, referrer policy),
//   - input validation on every route spot-checked + consistent error
//     envelope, no password material in any response (rule 8),
//   - UI: admin pages, toasts, theme toggle persistence, staff 403.
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
    /* non-JSON body (e.g. the 403 page from middleware) */
  }
  return { status: res.status, json, text, headers: res.headers }
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

async function cleanup(orgIds: mongoose.Types.ObjectId[]) {
  if (orgIds.length === 0) return
  await Budget.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await Department.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ organizationId: { $in: orgIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })
}

async function main() {
  await connectDB()

  // Remove fixtures from an interrupted earlier run (only this script creates
  // organizations with this prefix).
  const stale = await Organization.find({ name: /^Phase5 Verify/ })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  if (stale.length) {
    await cleanup(stale.map((o) => o._id))
    console.log(`INFO  removed ${stale.length} stale verify org(s)`)
  }

  // ---------- Fixtures ----------
  const orgV = await Organization.create({ name: `Phase5 Verify ${runId}` })
  const orgOther = await Organization.create({
    name: `Phase5 Verify Other ${runId}`,
  })
  const dept = await Department.create({
    organizationId: orgV._id,
    name: `Support ${runId}`,
  })
  const deptOther = await Department.create({
    organizationId: orgOther._id,
    name: `Other Dept ${runId}`,
  })
  const deptName = `Support ${runId}`
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
  const manager = await mkUser(
    orgV._id,
    dept._id,
    'Mona Manager',
    `mgr-${runId}@verify.test`,
    'manager',
  )
  const staff = await mkUser(
    orgV._id,
    dept._id,
    'Sam Staff',
    `staff-${runId}@verify.test`,
    'staff',
  )
  const otherAdmin = await mkUser(
    orgOther._id,
    deptOther._id,
    'Otto Other',
    `other-${runId}@verify.test`,
    'admin',
  )

  const adminId = String(admin._id)
  const managerId = String(manager._id)
  const staffId = String(staff._id)
  const otherAdminId = String(otherAdmin._id)
  const deptId = String(dept._id)
  const deptOtherId = String(deptOther._id)
  const adminEmail = `admin-${runId}@verify.test`
  const managerEmail = `mgr-${runId}@verify.test`

  const adminCookie = await login(adminEmail, PASS)
  const managerCookie = await login(managerEmail, PASS)
  const staffCookie = await login(`staff-${runId}@verify.test`, PASS)
  const apiEmail = `api-${runId}@verify.test`

  // ---------- A. Access control ----------
  console.log('\n--- A. Admin API access control ---')

  const anon = await api(null, 'GET', '/api/admin/users')
  check('anonymous admin list is 401', anon.status === 401, anon.status)

  const mgrUsers = await api(managerCookie, 'GET', '/api/admin/users')
  check('manager admin list is 403', mgrUsers.status === 403, mgrUsers.status)

  const staffDept = await api(staffCookie, 'POST', '/api/admin/departments', {
    name: `Nope ${runId}`,
  })
  check('staff cannot create departments (403)', staffDept.status === 403)

  const mgrPatch = await api(
    managerCookie,
    'PATCH',
    `/api/admin/users/${adminId}`,
    {
      role: 'staff',
    },
  )
  check('manager cannot patch users (403)', mgrPatch.status === 403)

  const staffPage = await api(staffCookie, 'GET', '/admin/users')
  check(
    'middleware 403s /admin/users for staff',
    staffPage.status === 403 && staffPage.text.includes('Forbidden'),
    staffPage.status,
  )

  // ---------- B. Users ----------
  console.log('\n--- B. Admin user management ---')

  const list = await api(adminCookie, 'GET', '/api/admin/users')
  const listItems = (list.json?.items ?? []) as { email: string }[]
  check(
    'admin lists the org users',
    list.status === 200 &&
      listItems.some((u) => u.email === adminEmail) &&
      listItems.some((u) => u.email === managerEmail),
    list.status,
  )
  check(
    'user list never contains password material',
    !list.text.includes('passwordHash') && !list.text.includes('$2b$'),
  )
  check(
    'user list does not leak another org (isolation)',
    !list.text.includes(`other-${runId}@verify.test`),
  )

  const created = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Cara Creator',
    email: apiEmail,
    password: PASS,
    role: 'staff',
    departmentId: deptId,
  })
  const createdUser = created.json?.user as
    { id: string; role: string; departmentId: string | null } | undefined
  check(
    'admin creates a user (201, no password in response)',
    created.status === 201 &&
      !created.text.includes('passwordHash') &&
      !created.text.includes('$2b$'),
    created.status,
  )
  check(
    'created user has the requested role and department',
    createdUser?.role === 'staff' && createdUser?.departmentId === deptId,
    createdUser,
  )
  const apiId = createdUser?.id ?? ''

  const apiLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: apiEmail, password: PASS }),
  })
  check('created user can sign in with the initial password', apiLogin.ok)

  const weakPw = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Weak',
    email: `weak-${runId}@verify.test`,
    password: 'abc',
    role: 'staff',
    departmentId: null,
  })
  check(
    'short password rejected (400 with details)',
    weakPw.status === 400 &&
      typeof weakPw.json?.error === 'string' &&
      weakPw.json?.details !== undefined,
    weakPw.status,
  )

  const injected = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Inject',
    email: `inject-${runId}@verify.test`,
    password: PASS,
    role: 'staff',
    departmentId: null,
    organizationId: String(orgOther._id),
  })
  check(
    'extra fields rejected (400, rule 2)',
    injected.status === 400,
    injected.status,
  )

  const dupEmail = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Dup',
    email: adminEmail,
    password: PASS,
    role: 'staff',
    departmentId: null,
  })
  check('duplicate email rejected (409)', dupEmail.status === 409)

  const foreignDept = await api(adminCookie, 'POST', '/api/admin/users', {
    name: 'Foreign',
    email: `foreign-${runId}@verify.test`,
    password: PASS,
    role: 'staff',
    departmentId: deptOtherId,
  })
  check(
    "another org's department rejected (400)",
    foreignDept.status === 400,
    foreignDept.status,
  )

  const roleChange = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${apiId}`,
    { role: 'manager', departmentId: null },
  )
  check(
    'admin assigns a new role and clears the department',
    roleChange.status === 200 &&
      (roleChange.json?.user as { role: string }).role === 'manager' &&
      (roleChange.json?.user as { departmentId: string | null })
        .departmentId === null,
    roleChange.status,
  )

  const selfRole = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${adminId}`,
    {
      role: 'staff',
    },
  )
  check(
    'admin cannot change own role (lockout guard)',
    selfRole.status === 400,
    selfRole.status,
  )

  const selfDeactivate = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { isActive: false },
  )
  check(
    'admin cannot deactivate self (lockout guard)',
    selfDeactivate.status === 400,
    selfDeactivate.status,
  )

  const badId = await api(adminCookie, 'PATCH', '/api/admin/users/not-an-id', {
    role: 'staff',
  })
  check('an invalid user id is a 404', badId.status === 404, badId.status)

  const crossTenant = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${otherAdminId}`,
    { role: 'staff' },
  )
  check(
    "another org's user id is a 404",
    crossTenant.status === 404,
    crossTenant.status,
  )

  const deactivated = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${apiId}`,
    { isActive: false },
  )
  const loginDeactivated = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: apiEmail, password: PASS }),
  })
  check(
    'deactivated user cannot sign in',
    deactivated.status === 200 && loginDeactivated.status === 401,
    [deactivated.status, loginDeactivated.status],
  )

  const reactivated = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${apiId}`,
    { isActive: true },
  )
  const loginReactivated = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: apiEmail, password: PASS }),
  })
  check(
    'reactivated user can sign in again',
    reactivated.status === 200 && loginReactivated.status === 200,
    [reactivated.status, loginReactivated.status],
  )

  const emailClash = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${apiId}`,
    {
      email: managerEmail,
    },
  )
  check('changing email to an existing one is 409', emailClash.status === 409)

  // ---------- C. Departments ----------
  console.log('\n--- C. Admin department management ---')

  const dept2Name = `Second ${runId}`
  const dept2 = await api(adminCookie, 'POST', '/api/admin/departments', {
    name: dept2Name,
  })
  const dept2Id = (dept2.json?.department as { id: string } | undefined)?.id
  check('admin creates a department (201)', dept2.status === 201 && !!dept2Id)

  const deptDup = await api(adminCookie, 'POST', '/api/admin/departments', {
    name: dept2Name,
  })
  check('duplicate department name is 409', deptDup.status === 409)

  const deptShort = await api(adminCookie, 'POST', '/api/admin/departments', {
    name: 'x',
  })
  check('one-character department name is 400', deptShort.status === 400)

  const deptList = await api(adminCookie, 'GET', '/api/admin/departments')
  const deptItems = (deptList.json?.items ?? []) as {
    name: string
    userCount: number
  }[]
  const supportRow = deptItems.find((d) => d.name === deptName)
  check(
    'department list includes both departments with member counts',
    deptList.status === 200 &&
      !!supportRow &&
      supportRow.userCount === 2 &&
      deptItems.some((d) => d.name === dept2Name),
    deptItems,
  )

  const deptRename = await api(
    adminCookie,
    'PATCH',
    `/api/admin/departments/${dept2Id}`,
    { name: `Renamed ${runId}` },
  )
  check('admin renames a department (200)', deptRename.status === 200)

  const renameClash = await api(
    adminCookie,
    'PATCH',
    `/api/admin/departments/${dept2Id}`,
    { name: deptName },
  )
  check(
    'renaming onto an existing name is 409',
    renameClash.status === 409,
    renameClash.status,
  )

  const delBusy = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${deptId}`,
  )
  check(
    'deleting a department with users is 409',
    delBusy.status === 409 &&
      String(delBusy.json?.error ?? '').includes('still assigned'),
    delBusy.json,
  )

  // A budget raises the guard too. The budget is created while the manager
  // is still assigned, then removed only after the blocked-delete check —
  // sessions refresh the department from the DB, so the manager must be
  // reassigned before they can delete their department's budget.
  const budget = await api(managerCookie, 'POST', '/api/budgets', {
    category: 'Transport',
    amount: 500,
    month: month(),
  })
  check('manager sets a budget in the department', budget.status === 201)
  const budgetId = (budget.json?.budget as { id: string } | undefined)?.id

  const unassignStaff = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${staffId}`,
    {
      departmentId: null,
    },
  )
  const unassignManager = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${managerId}`,
    { departmentId: null },
  )
  check(
    'admin unassigns both members from the department',
    unassignStaff.status === 200 && unassignManager.status === 200,
    [unassignStaff.status, unassignManager.status],
  )

  const delBudgetBlocked = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${deptId}`,
  )
  check(
    'deleting a department with budgets is 409',
    delBudgetBlocked.status === 409 &&
      String(delBudgetBlocked.json?.error ?? '').includes('budget'),
    delBudgetBlocked.json,
  )

  const reassignManager = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${managerId}`,
    { departmentId: deptId },
  )
  check(
    'admin reassigns the manager so they can clear the budget',
    reassignManager.status === 200,
    reassignManager.status,
  )

  const delBudget = await api(
    managerCookie,
    'DELETE',
    `/api/budgets/${budgetId}`,
  )
  check(
    'manager deletes the budget',
    delBudget.status === 200,
    delBudget.status,
  )

  const finalUnassign = await api(
    adminCookie,
    'PATCH',
    `/api/admin/users/${managerId}`,
    { departmentId: null },
  )
  check(
    'manager is unassigned again before the final delete',
    finalUnassign.status === 200,
    finalUnassign.status,
  )

  const delOk = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${deptId}`,
  )
  check('deleting the now-empty department succeeds', delOk.status === 200)

  const delAgain = await api(
    adminCookie,
    'DELETE',
    `/api/admin/departments/${deptId}`,
  )
  check('deleting it twice is a 404', delAgain.status === 404)

  const deptListAfter = await api(adminCookie, 'GET', '/api/admin/departments')
  check(
    'deleted department is gone, renamed one remains',
    !deptListAfter.text.includes(deptName) &&
      deptListAfter.text.includes(`Renamed ${runId}`),
  )

  // ---------- D. Audit trail (rule 7) ----------
  console.log('\n--- D. Audit trail ---')

  const audits = await AuditLog.find({ organizationId: orgV._id })
    .select('action entity')
    .lean<{ action: string; entity: string }[]>()
  const key = (entity: string, action: string) =>
    audits.some((a) => a.entity === entity && a.action === action)
  check(
    'user create/update audited',
    key('User', 'create') && key('User', 'update'),
    audits,
  )
  check(
    'department create/update/delete audited',
    key('Department', 'create') &&
      key('Department', 'update') &&
      key('Department', 'delete'),
    audits,
  )
  check(
    'budget create/delete audited',
    key('Budget', 'create') && key('Budget', 'delete'),
  )

  // ---------- E. Security headers and error format ----------
  console.log('\n--- E. Security headers and validation sweep ---')

  const home = await api(null, 'GET', '/')
  const csp = home.headers.get('content-security-policy') ?? ''
  check(
    'CSP header present with default-src self',
    csp.includes("default-src 'self'") &&
      csp.includes("frame-ancestors 'none'"),
    csp,
  )
  check(
    'X-Frame-Options DENY and nosniff set',
    home.headers.get('x-frame-options') === 'DENY' &&
      home.headers.get('x-content-type-options') === 'nosniff',
  )
  check(
    'Referrer-Policy and Permissions-Policy set',
    home.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' &&
      (home.headers.get('permissions-policy') ?? '').includes('camera=()'),
  )
  check(
    'HSTS header present',
    (home.headers.get('strict-transport-security') ?? '').startsWith(
      'max-age=',
    ),
  )

  const health = await api(null, 'GET', '/api/health')
  check(
    'security headers also cover API routes',
    (health.headers.get('x-content-type-options') ?? '') === 'nosniff' &&
      (health.headers.get('content-security-policy') ?? '').length > 0,
  )

  const badPageSize = await api(
    adminCookie,
    'GET',
    '/api/expenses?pageSize=abc',
  )
  check(
    'invalid expense query is 400 with the error envelope',
    badPageSize.status === 400 && typeof badPageSize.json?.error === 'string',
    badPageSize.status,
  )
  const badExport = await api(
    adminCookie,
    'GET',
    '/api/reports/export?report=bogus',
  )
  check(
    'invalid export query is 400 with the error envelope',
    badExport.status === 400 && typeof badExport.json?.error === 'string',
    badExport.status,
  )
  const badBody = await api(adminCookie, 'POST', '/api/admin/departments', {
    name: '',
  })
  check(
    'admin route validation failure is 400 + details',
    badBody.status === 400 &&
      typeof badBody.json?.error === 'string' &&
      badBody.json?.details !== undefined,
    badBody.json,
  )

  // ---------- F. UI ----------
  console.log('\n--- F. Browser UI ---')
  await uiChecks({
    adminEmail,
    staffEmail: `staff-${runId}@verify.test`,
    runId,
  })

  // ---------- Cleanup ----------
  await cleanup([orgV._id, orgOther._id])
  const leftovers = await Promise.all([
    Department.countDocuments({
      organizationId: { $in: [orgV._id, orgOther._id] },
    }),
    User.countDocuments({ organizationId: { $in: [orgV._id, orgOther._id] } }),
  ])
  console.log(
    `INFO  cleanup: leftover departments/users=${leftovers.join('/')}`,
  )
  await mongoose.disconnect()

  console.log(`\nRESULT  ${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.log('FAILURES:\\n' + failures.map((f) => ` - ${f}`).join('\\n'))
    process.exitCode = 1
  }
}

async function uiChecks(opts: {
  adminEmail: string
  staffEmail: string
  runId: string
}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []
  // Browsers log every failed HTTP response as a console error. Two checks
  // below provoke failures on purpose (a 409 guard, a 403 page), so those
  // are collected separately and only unexpected statuses may fail the run.
  const failedRequests: string[] = []

  const newPage = async (email: string) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
    page.on('console', (m) => {
      // CSP violations also surface as console errors — this proves the
      // security headers don't break the app.
      if (m.type() !== 'error') return
      if (m.text().includes('Failed to load resource')) {
        failedRequests.push(m.text())
        return
      }
      errors.push(`[console] ${m.text()}`)
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
    await page.fill('input[id=password]', 'VerifyPass123!')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 20_000 })
    return page
  }

  try {
    const admin = await newPage(opts.adminEmail)

    // Admin navigation exposes the admin destinations.
    await admin.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    check(
      'UI admin navigation shows Users and Departments',
      (await admin.getByRole('link', { name: 'Users' }).count()) === 1 &&
        (await admin.getByRole('link', { name: 'Departments' }).count()) === 1,
    )

    // Departments first, so the user form can assign the new department.
    await admin.goto(`${BASE}/admin/departments`, {
      waitUntil: 'domcontentloaded',
    })
    await admin.waitForFunction(
      () => {
        const btn = document.querySelector('form button[type=submit]')
        return (
          !!btn && Object.keys(btn).some((k) => k.startsWith('__reactProps'))
        )
      },
      undefined,
      { timeout: 20_000 },
    )
    const uiDeptName = `UI Dept ${opts.runId}`
    await admin.fill('#new-dept-name', uiDeptName)
    await admin.getByRole('button', { name: /^create department$/i }).click()
    await admin
      .getByText('Department created')
      .waitFor({ state: 'visible', timeout: 20_000 })
    await admin
      .getByRole('row')
      .filter({ hasText: uiDeptName })
      .waitFor({ timeout: 20_000 })
    check('UI create department shows a toast and the new row', true)

    // Create a user assigned to that department.
    await admin.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
    await admin.waitForFunction(
      () => {
        const btn = document.querySelector('form button[type=submit]')
        return (
          !!btn && Object.keys(btn).some((k) => k.startsWith('__reactProps'))
        )
      },
      undefined,
      { timeout: 20_000 },
    )
    const uiEmail = `ui-${opts.runId}@verify.test`
    await admin.fill('#new-user-name', 'Uma UI')
    await admin.fill('#new-user-email', uiEmail)
    await admin.fill('#new-user-password', 'VerifyPass123!')
    await admin.selectOption('#new-user-role', 'staff')
    await admin.selectOption('#new-user-department', { label: uiDeptName })
    await admin.getByRole('button', { name: /^create user$/i }).click()
    await admin
      .getByText('User created')
      .waitFor({ state: 'visible', timeout: 20_000 })
    await admin
      .getByRole('row')
      .filter({ hasText: uiEmail })
      .waitFor({ timeout: 20_000 })
    check('UI create user shows a toast and the new row', true)

    // The new department can't be deleted while the user is assigned.
    await admin.goto(`${BASE}/admin/departments`, {
      waitUntil: 'domcontentloaded',
    })
    const deptRow = admin.getByRole('row').filter({ hasText: uiDeptName })
    await deptRow.waitFor({ timeout: 20_000 })
    admin.on('dialog', (dialog) => dialog.accept())
    await deptRow.getByRole('button', { name: /^delete$/i }).click()
    await admin
      .getByText('still assigned')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
    check('UI delete is refused while a user is assigned (409 shown)', true)

    // Unassign the user, then delete the department.
    await admin.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
    const userRow = admin.getByRole('row').filter({ hasText: uiEmail })
    await userRow.waitFor({ timeout: 20_000 })
    await userRow.locator('select[id^=dept-]').selectOption('')
    await userRow.getByRole('button', { name: /^save$/i }).click()
    await admin
      .getByText('Changes saved')
      .waitFor({ state: 'visible', timeout: 20_000 })
    check('UI role/department save shows a toast', true)

    await admin.goto(`${BASE}/admin/departments`, {
      waitUntil: 'domcontentloaded',
    })
    const deptRow2 = admin.getByRole('row').filter({ hasText: uiDeptName })
    await deptRow2.waitFor({ timeout: 20_000 })
    await deptRow2.getByRole('button', { name: /^delete$/i }).click()
    await admin
      .getByText('Department deleted')
      .waitFor({ state: 'visible', timeout: 20_000 })
    check('UI department delete succeeds after unassigning', true)

    // Theme toggle: switches class and persists across a reload.
    const themeButton = admin.getByRole('button', {
      name: /switch to (dark|light) theme/i,
    })
    const wasDark = await admin.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    await themeButton.click()
    const nowDark = await admin.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    check('UI theme toggle flips the dark class', wasDark !== nowDark, [
      wasDark,
      nowDark,
    ])
    await admin.reload({ waitUntil: 'domcontentloaded' })
    const afterReload = await admin.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    )
    check('UI theme choice persists across reloads', afterReload === nowDark)

    // Staff: /admin/users is forbidden and no admin nav links.
    const staff = await newPage(opts.staffEmail)
    const staffRes = await staff.goto(`${BASE}/admin/users`, {
      waitUntil: 'domcontentloaded',
    })
    check(
      'UI staff visiting /admin/users gets 403',
      staffRes?.status() === 403,
      staffRes?.status(),
    )
    await staff.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    check(
      'UI staff navigation has no admin links',
      (await staff.getByRole('link', { name: 'Users' }).count()) === 0 &&
        (await staff.getByRole('link', { name: 'Departments' }).count()) === 0,
    )

    check('UI: no uncaught page/console errors', errors.length === 0, errors)
    const unexpected = failedRequests.filter(
      (t) => !/status of (403|409)/.test(t),
    )
    check(
      'UI: only the deliberate 409/403 responses were logged as failed requests',
      unexpected.length === 0,
      unexpected,
    )
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
