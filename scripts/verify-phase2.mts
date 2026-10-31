// Phase 2 (Expense CRUD) end-to-end verification against the master prompt.
//
// Usage: npx tsx scripts/verify-phase2.mts   (dev server must be running)
//
// Creates a throwaway organization with two departments and four users, then
// exercises the real HTTP API and the browser UI: role scopes, ownership by ID,
// validation, filters/pagination/sorting, pending-only edits and audit entries.
// All fixtures are removed at the end; demo data is never touched.

import { loadEnvFile } from 'node:process'
import mongoose from 'mongoose'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { Organization } = await import('../models/organization.ts')
const { User } = await import('../models/user.ts')
const { Expense } = await import('../models/expense.ts')
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
  createdAt: string
}

type ApiBody = {
  error?: string
  details?: { fieldErrors?: Record<string, string[]> }
  expense?: ExpenseJson
  items?: ExpenseJson[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  success?: boolean
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

function day(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function dbExpensesByOrg(orgId: unknown) {
  return Expense.find({ organizationId: orgId }).lean<{ _id: unknown }[]>()
}

async function main() {
  await connectDB()

  // Remove fixtures from an interrupted earlier run (only this script creates
  // organizations with this prefix).
  const stale = await Organization.find({ name: /^Phase2 Verify/ })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  if (stale.length) {
    const ids = stale.map((o) => o._id)
    await Expense.deleteMany({ organizationId: { $in: ids } })
    await AuditLog.deleteMany({ organizationId: { $in: ids } })
    await User.deleteMany({ organizationId: { $in: ids } })
    await Organization.deleteMany({ _id: { $in: ids } })
    console.log(`INFO  removed ${ids.length} stale verify org(s)`)
  }

  const orgV = await Organization.create({
    name: `Phase2 Verify ${runId}`,
  })
  const orgB = await Organization.create({
    name: `Phase2 Verify Other ${runId}`,
  })
  const deptA = new mongoose.Types.ObjectId()
  const deptB = new mongoose.Types.ObjectId()
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

  await mkUser(
    orgV._id,
    deptA,
    'Vera Manager',
    `mgr-${runId}@verify.test`,
    'manager',
  )
  await mkUser(
    orgV._id,
    deptA,
    'Stan Staff',
    `staff-a-${runId}@verify.test`,
    'staff',
  )
  await mkUser(
    orgV._id,
    deptB,
    'Sara Staff',
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
    null,
    'Otto Other',
    `staff-other-${runId}@verify.test`,
    'staff',
  )

  const manager = await login(`mgr-${runId}@verify.test`, PASS)
  const staff1 = await login(`staff-a-${runId}@verify.test`, PASS)
  const staff2 = await login(`staff-b-${runId}@verify.test`, PASS)
  const admin = await login(`admin-${runId}@verify.test`, PASS)
  const managerNull = await login(`mgr-null-${runId}@verify.test`, PASS)
  const otherStaff = await login(`staff-other-${runId}@verify.test`, PASS)

  // ---------- CRUD as staff ----------
  const mk = (cookie: string, body: Record<string, unknown>) =>
    api(cookie, 'POST', '/api/expenses', body)

  const a = await mk(staff1, {
    category: 'Meals',
    amount: 100,
    date: day(-10),
    description: 'A meals',
  })
  const b = await mk(staff1, {
    category: 'Supplies',
    amount: 10,
    date: day(-5),
    description: 'B supplies',
  })
  const c = await mk(staff1, {
    category: 'Transport',
    amount: 25,
    date: day(0),
    description: 'C transport',
  })
  const d = await mk(staff1, {
    category: 'Meals',
    amount: 40,
    date: day(0),
    description: 'D meals',
  })
  const e = await mk(staff1, {
    category: 'Other',
    amount: 5,
    date: day(-2),
    description: 'E other',
  })
  const f = await mk(staff2, {
    category: 'Meals',
    amount: 70,
    date: day(0),
    description: 'F meals dept B',
  })

  check(
    'staff can create expenses (201)',
    [a, b, c, d, e, f].every(
      (r) =>
        r.status === 201 &&
        r.json?.expense?.status === 'pending' &&
        r.json?.expense?.userId,
    ),
    [a.status, b.status, c.status, d.status, e.status, f.status],
  )
  check(
    'server assigns organizationId/departmentId/userId (not client)',
    a.json?.expense?.organizationId === String(orgV._id) &&
      a.json?.expense?.departmentId === String(deptA) &&
      a.json?.expense?.userId !== undefined &&
      a.json?.expense?.departmentId !== undefined,
    a.json?.expense,
  )

  const e1 = a.json?.expense?.id
  const e2 = b.json?.expense?.id
  const e6 = f.json?.expense?.id

  const list = (cookie: string, qs = '') =>
    api(cookie, 'GET', `/api/expenses${qs ? `?${qs}` : ''}`)

  // ---------- Role scopes ----------
  const staff1List = await list(staff1)
  const staff2List = await list(staff2)
  const managerList = await list(manager)
  const adminList = await list(admin, 'pageSize=100')
  const otherList = await list(otherStaff)

  check(
    'staff sees only their own expenses',
    staff1List.json?.total === 5 &&
      staff1List.json.items.every(
        (x) => x.userId === a.json?.expense?.userId,
      ) &&
      staff2List.json?.total === 1,
    [staff1List.json?.total, staff2List.json?.total],
  )
  check(
    'manager sees their department only (5 of 6, not dept B)',
    managerList.json?.total === 5 &&
      managerList.json.items.every((x) => x.departmentId === String(deptA)) &&
      !managerList.json.items.some((x) => x.id === e6),
    managerList.json?.total,
  )
  check(
    'admin sees all organization expenses',
    adminList.json?.total === 6,
    adminList.json?.total,
  )
  check(
    'other organization sees nothing (multi-tenant)',
    otherList.json?.total === 0,
    otherList.json?.total,
  )

  // ---------- Ownership enforced by ID ----------
  const byId = (
    cookie: string | null,
    id: string,
    method = 'GET',
    body?: unknown,
  ) => api(cookie, method, `/api/expenses/${id}`, body)

  const x = await byId(staff2, e1)
  check(
    "staff cannot READ another staff member's expense (404)",
    x.status === 404,
    x,
  )
  check(
    "staff cannot PATCH another staff member's expense (404)",
    (await byId(staff2, e1, 'PATCH', { amount: 1 })).status === 404,
  )
  check(
    "staff cannot DELETE another staff member's expense (404)",
    (await byId(staff2, e1, 'DELETE')).status === 404,
  )
  check(
    'staff cannot read a dept-B expense by id',
    (await byId(staff1, e6)).status === 404,
  )
  check(
    'manager CAN read a department expense by id, but cannot mutate it',
    (await byId(manager, e1)).status === 200 &&
      (await byId(manager, e1, 'PATCH', { amount: 1 })).status === 403 &&
      (await byId(manager, e1, 'DELETE')).status === 403,
  )
  // Phase 7B: managers record their own expenses too (an admin reviews them).
  const mgrOwn = await mk(manager, {
    category: 'Other',
    amount: 1,
    date: day(0),
    description: 'Manager own expense',
  })
  check(
    'manager creates their own expense (201, submitterRole manager)',
    mgrOwn.status === 201 &&
      mgrOwn.json?.expense?.submitterRole === 'manager' &&
      mgrOwn.json?.expense?.departmentId === String(deptA),
    mgrOwn.json,
  )
  check(
    'manager edits and deletes their own pending expense (200)',
    (await byId(manager, mgrOwn.json!.expense!.id, 'PATCH', { amount: 2 }))
      .status === 200 &&
      (await byId(manager, mgrOwn.json!.expense!.id, 'DELETE')).status === 200,
  )
  check(
    'admin can read any org expense but cannot mutate (403)',
    (await byId(admin, e6)).status === 200 &&
      (await byId(admin, e6, 'DELETE')).status === 403,
  )
  check(
    "other tenant cannot read/PATCH another org's expense id",
    (await byId(otherStaff, e1)).status === 404 &&
      (await byId(otherStaff, e1, 'PATCH', { amount: 1 })).status === 404 &&
      (await byId(otherStaff, e1, 'DELETE')).status === 404,
  )
  check(
    'unauthenticated requests get 401',
    (await list(null)).status === 401 && (await byId(null, e1)).status === 401,
  )

  // ---------- Validation (rule 3) ----------
  const invalid: Record<string, Record<string, unknown>> = {
    'amount = 0': { category: 'Other', amount: 0, date: day(0) },
    'negative amount': { category: 'Other', amount: -5, date: day(0) },
    'future date': { category: 'Other', amount: 5, date: day(1) },
    'impossible date': { category: 'Other', amount: 5, date: '2026-02-31' },
    'unknown category': { category: 'Candy', amount: 5, date: day(0) },
    'description > 200': {
      category: 'Other',
      amount: 5,
      date: day(0),
      description: 'x'.repeat(201),
    },
    'client-supplied status': {
      category: 'Other',
      amount: 5,
      date: day(0),
      status: 'approved',
    },
    'client-supplied userId': {
      category: 'Other',
      amount: 5,
      date: day(0),
      userId: String(new mongoose.Types.ObjectId()),
    },
  }

  for (const [name, body] of Object.entries(invalid)) {
    const r = await mk(staff1, body)
    check(
      `POST rejects ${name} (400 + details)`,
      r.status === 400 && !!r.json?.details,
      { status: r.status, body: r.json },
    )
  }

  check(
    'GET list rejects invalid filters (400)',
    (await list(admin, 'pageSize=500')).status === 400 &&
      (await list(admin, 'category=Candy')).status === 400 &&
      (await list(admin, `from=${day(0)}&to=${day(-1)}`)).status === 400,
  )

  // ---------- Update ----------
  const upd = await byId(staff1, e1, 'PATCH', {
    amount: 120,
    description: 'A meals updated',
  })
  check(
    'staff can update own pending expense',
    upd.status === 200 &&
      upd.json?.expense?.amount === 120 &&
      upd.json?.expense?.description === 'A meals updated' &&
      upd.json?.expense?.status === 'pending',
    upd,
  )
  check(
    'PATCH rejects client-supplied status (400)',
    (await byId(staff1, e1, 'PATCH', { status: 'approved' })).status === 400,
  )

  // ---------- Pending-only edits (rule 4) ----------
  await Expense.updateOne({ _id: e2 }, { status: 'approved' })
  check(
    'approved expense cannot be edited (409)',
    (await byId(staff1, e2, 'PATCH', { amount: 11 })).status === 409,
  )
  check(
    'approved expense cannot be deleted (409)',
    (await byId(staff1, e2, 'DELETE')).status === 409,
  )

  // ---------- Filters / sorting / pagination ----------
  const meals = await list(admin, 'pageSize=100&category=Meals')
  check(
    'filter by category',
    meals.json?.total === 3 &&
      meals.json.items.every((x) => x.category === 'Meals'),
    meals.json?.total,
  )
  const approved = await list(admin, 'status=approved')
  check(
    'filter by status',
    approved.json?.total === 1 && approved.json.items[0].id === e2,
    approved.json,
  )
  const fromToday = await list(admin, `pageSize=100&from=${day(0)}`)
  check(
    'filter by from date (inclusive)',
    fromToday.json?.total === 3 &&
      fromToday.json.items.every((x) => x.date.slice(0, 10) >= day(0)),
    fromToday.json?.total,
  )
  const range = await list(admin, `pageSize=100&from=${day(-6)}&to=${day(-1)}`)
  check(
    'filter by date range',
    range.json?.total === 2,
    range.json?.items?.map((x) => x.date),
  )
  const asc = await list(admin, 'pageSize=100&sortBy=amount&sortDir=asc')
  check(
    'sort by amount ascending',
    JSON.stringify(asc.json?.items?.map((x) => x.amount)) ===
      JSON.stringify([5, 10, 25, 40, 70, 120]),
    asc.json?.items?.map((x) => x.amount),
  )
  const p1 = await list(admin, 'page=1&pageSize=2&sortBy=amount&sortDir=asc')
  const p2 = await list(admin, 'page=2&pageSize=2&sortBy=amount&sortDir=asc')
  check(
    'pagination returns distinct consecutive pages',
    p1.json?.total === 6 &&
      p1.json?.totalPages === 3 &&
      p1.json?.pageSize === 2 &&
      p1.json?.items?.length === 2 &&
      p2.json?.items?.length === 2 &&
      p2.json?.items?.[0]?.amount === 25,
    [p1.json, p2.json],
  )

  // ---------- Delete + audit ----------
  const del = await byId(staff1, e1, 'DELETE')
  check(
    'staff can delete own pending expense',
    del.status === 200 && !(await Expense.findById(e1).lean()),
    del,
  )
  check(
    'deleted expense is gone by id (404)',
    (await byId(staff1, e1)).status === 404,
  )

  const audits = await AuditLog.find({
    organizationId: orgV._id,
    entityId: e1,
  }).lean<{ action: string; organizationId: unknown; userId: unknown }[]>()
  const actions = audits.map((r) => r.action).sort()
  check(
    'audit entries written for create, update, delete',
    JSON.stringify(actions) === JSON.stringify(['create', 'delete', 'update']),
    actions,
  )
  check(
    'audit entries carry org + actor',
    audits.length === 3 &&
      audits.every(
        (r) =>
          String(r.organizationId) === String(orgV._id) &&
          String(r.userId) === String(a.json?.expense?.userId),
      ),
  )

  // ---------- Password never returned ----------
  const me = await api(staff1, 'GET', '/api/auth/me')
  check(
    'no passwordHash in /api/auth/me or expense payloads',
    !me.text.includes('passwordHash') &&
      !staff1List.text.includes('passwordHash'),
  )

  // ---------- Manager without a department ----------
  await mkUser(
    orgV._id,
    null,
    'Nina Staff',
    `staff-null-${runId}@verify.test`,
    'staff',
  )
  const staffNull = await login(`staff-null-${runId}@verify.test`, PASS)
  const g = await mk(staffNull, {
    category: 'Other',
    amount: 3,
    date: day(0),
    description: 'G no dept',
  })
  const nullList = await list(managerNull, 'pageSize=100')
  const leaked = nullList.json?.items?.some((x) => x.id === g.json?.expense?.id)
  check(
    'manager with no department sees no department-scoped expenses',
    nullList.json?.total === 0 && !leaked,
    nullList.json,
  )

  // ---------- UI flow ----------
  await uiChecks({
    staffEmail: `staff-a-${runId}@verify.test`,
    managerEmail: `mgr-${runId}@verify.test`,
    adminEmail: `admin-${runId}@verify.test`,
  })

  // ---------- Cleanup ----------
  const orgIds = [orgV._id, orgB._id]
  const userIds = (
    await User.find({ organizationId: { $in: orgIds } })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId }[]>()
  ).map((u) => u._id)
  await Expense.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ _id: { $in: userIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })
  const leftover = await dbExpensesByOrg(orgV._id)
  console.log(`INFO  cleanup: leftover expenses=${leftover.length}`)
  await mongoose.disconnect()

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('FAILURES:\n' + failures.map((f) => ` - ${f}`).join('\n'))
    process.exitCode = 1
  }
}

async function uiChecks(emails: {
  staffEmail: string
  managerEmail: string
  adminEmail: string
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
    // Staff: create -> edit -> delete through the UI.
    const staff = await newPage(emails.staffEmail)
    await staff.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' })
    const newLink = staff.getByRole('link', { name: /new expense/i })
    check('UI staff sees "New expense"', await newLink.isVisible())

    await newLink.click()
    await staff.waitForURL('**/expenses/new', { timeout: 10_000 })
    await staff.selectOption('select[id=category]', 'Events')
    await staff.fill('input[id=amount]', '33.5')
    await staff.fill('textarea[id=description]', 'UI created expense')
    await staff.getByRole('button', { name: /create expense/i }).click()
    await staff.waitForURL('**/expenses', { timeout: 15_000 })

    const row = staff.getByRole('row', { name: /UI created expense/ })
    check(
      'UI create shows the new expense row (33.50, pending)',
      (await row.count()) === 1 &&
        (await row.textContent())!.includes('33.50') &&
        (await row.textContent())!.includes('pending'),
      await row.textContent(),
    )

    await row.getByRole('link', { name: /edit/i }).click()
    await staff.waitForURL('**/edit', { timeout: 10_000 })
    const amountBox = staff.locator('input[id=amount]').first()
    await amountBox.waitFor({ state: 'visible' })
    check(
      'UI edit form is prefilled from the API',
      (await amountBox.inputValue()) === '33.5',
      await amountBox.inputValue(),
    )
    await amountBox.fill('44.25')
    await staff.getByRole('button', { name: /save changes/i }).click()
    await staff.waitForURL('**/expenses', { timeout: 15_000 })
    check(
      'UI edit persists the new amount',
      (await staff
        .getByRole('row', { name: /UI created expense/ })
        .textContent())!.includes('44.25'),
    )

    staff.on('dialog', (dlg) => dlg.accept())
    await staff
      .getByRole('row', { name: /UI created expense/ })
      .getByRole('button', { name: /^delete$/i })
      .click()
    let rowGone = true
    try {
      await staff
        .getByRole('row', { name: /UI created expense/ })
        .waitFor({ state: 'detached', timeout: 15_000 })
    } catch {
      rowGone = false
    }
    check('UI delete removes the row', rowGone)

    // Manager: can record their own expenses, but has no row actions on other
    // people's department rows (Phase 7B).
    const manager = await newPage(emails.managerEmail)
    await manager.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' })
    check(
      'UI manager has a "New expense" action (Phase 7B)',
      (await manager.getByRole('link', { name: /new expense/i }).count()) === 1,
    )
    check(
      "UI manager sees no edit/delete actions on other people's rows",
      (await manager.getByRole('link', { name: /^edit$/i }).count()) === 0 &&
        (await manager.getByRole('button', { name: /^delete$/i }).count()) ===
          0,
    )

    // Admin: org-wide list, read-only.
    const admin = await newPage(emails.adminEmail)
    await admin.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' })
    check(
      'UI admin sees org-wide expenses read-only',
      (await admin.getByRole('link', { name: /^edit$/i }).count()) === 0 &&
        (await admin.getByText(/all expenses in your organization/i).count()) >
          0,
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
