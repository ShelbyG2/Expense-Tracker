// Phase 7A (Security and account management) end-to-end verification.
//
// Usage: npx tsx scripts/verify-phase7a.mts   (dev or prod server must run)
//
// Creates a throwaway organization and verifies:
//   A. a deactivated user is locked out of the API and redirected, on the next
//      page load, through /api/auth/session-expired to /login?reason=deactivated
//      with the cookie cleared,
//   B. /account change-password: current password required, policy enforced,
//      audit entry written, old password stops working,
//   C. admin temporary password: generated once, mustChangePassword blocks
//      every page and API until changed, audit entry written, self/other-org
//      guards,
//   D. MongoDB rate limiter: 5/min for login, register and password change, the
//      counter lives in the collection (a second process sees the same limit),
//   E. sliding sessions: renewed with <2h left, never past the 7-day cap.
//   F. UI (Playwright): deactivation message, forced change page, wrong
//      password error, header Account link.
//
// Fixtures are removed at the end; exits non-zero on failure.

import { loadEnvFile } from 'node:process'
import { spawnSync } from 'node:child_process'
import mongoose from 'mongoose'
import { SignJWT } from 'jose'
import type { Page } from 'playwright'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const { connectDB } = await import('../lib/db.ts')
const { hashPassword } = await import('../lib/password.ts')
const { verifyToken } = await import('../lib/auth.ts')
const { Organization } = await import('../models/organization.ts')
const { Department } = await import('../models/department.ts')
const { User } = await import('../models/user.ts')
const { Budget } = await import('../models/budget.ts')
const { Expense } = await import('../models/expense.ts')
const { AuditLog } = await import('../models/audit-log.ts')
const { RateLimit } = await import('../models/rate-limit.ts')
const { checkRateLimit } = await import('../lib/rate-limit.ts')

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000'
const PASS = 'VerifyPass123!'
const NEWPASS = 'VerifyPass456!'
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
  headers: Record<string, string> = {},
) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON body (HTML page, redirect body) */
  }
  return { status: res.status, json, text, headers: res.headers }
}

type LoginResult = {
  status: number
  cookie: string | null
  json: Record<string, unknown> | null
  text: string
}

async function loginFull(
  email: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<LoginResult> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }
  const cookie =
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith('session=') && !c.startsWith('session=;'))
      ?.split(';')[0] ?? null
  return { status: res.status, cookie, json, text }
}

async function login(
  email: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const result = await loginFull(email, password, headers)
  if (!result.cookie) {
    throw new Error(
      `login failed for ${email}: ${result.status} ${result.text.slice(0, 200)}`,
    )
  }
  return result.cookie
}

// The limiter windows are aligned to wall-clock minutes. Wait for a fresh one
// before a burst, otherwise a boundary can split the attempts across two
// windows and make the test flaky.
const WINDOW_MS = 60_000
async function waitForWindow(minMsLeft = 10_000) {
  const left = WINDOW_MS - (Date.now() % WINDOW_MS)
  if (left < minMsLeft) {
    await new Promise((resolve) => setTimeout(resolve, left + 500))
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}

// Next 16 with cacheComponents serves a redirect() raised during render as a
// 200 document whose RSC payload tells the browser to navigate (rather than a
// 3xx Location). Accept both forms here; section F proves the browser really
// ends up on the target page.
function redirectedTo(
  res: { status: number; text: string; headers: Headers },
  target: string,
): boolean {
  if (isRedirect(res.status)) {
    return (res.headers.get('location') ?? '').includes(target)
  }
  return res.text.includes(target)
}

function sessionCookie(headers: Headers): string | null {
  return (
    headers
      .getSetCookie()
      .find((c) => c.startsWith('session=') && !c.startsWith('session=;')) ??
    null
  )
}

function clearsCookie(headers: Headers): boolean {
  return headers
    .getSetCookie()
    .some(
      (c) => c.startsWith('session=;') || /session=;\s*.*Max-Age=0/i.test(c),
    )
}

async function cleanup(orgIds: mongoose.Types.ObjectId[], rateKeys: string[]) {
  if (rateKeys.length) await RateLimit.deleteMany({ key: { $in: rateKeys } })
  if (orgIds.length === 0) return
  await Expense.deleteMany({ organizationId: { $in: orgIds } })
  await Budget.deleteMany({ organizationId: { $in: orgIds } })
  await AuditLog.deleteMany({ organizationId: { $in: orgIds } })
  await Department.deleteMany({ organizationId: { $in: orgIds } })
  await User.deleteMany({ organizationId: { $in: orgIds } })
  await Organization.deleteMany({ _id: { $in: orgIds } })
}

// ---------------- fixtures helpers ----------------

type Role = 'admin' | 'manager' | 'staff'

async function main() {
  await connectDB()

  // Remove fixtures from an interrupted earlier run.
  const stale = await Organization.find({ name: /^Phase7A Verify/ })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
  if (stale.length) {
    await cleanup(
      stale.map((o) => o._id),
      [],
    )
    console.log(`INFO  removed ${stale.length} stale verify org(s)`)
  }

  const orgV = await Organization.create({ name: `Phase7A Verify ${runId}` })
  const orgOther = await Organization.create({
    name: `Phase7A Verify Other ${runId}`,
  })
  const dept = await Department.create({
    organizationId: orgV._id,
    name: `Ops ${runId}`,
  })
  const hash = await hashPassword(PASS)

  const mkUser = (
    orgId: unknown,
    deptId: unknown,
    name: string,
    email: string,
    role: Role,
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
    dept._id,
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
  const deact = await mkUser(
    orgV._id,
    dept._id,
    'Dan Deactivated',
    `deact-${runId}@verify.test`,
    'staff',
  )
  const pwUser = await mkUser(
    orgV._id,
    dept._id,
    'Pia Password',
    `pw-${runId}@verify.test`,
    'staff',
  )
  const browserDeact = await mkUser(
    orgV._id,
    dept._id,
    'Bea Browser',
    `bdeact-${runId}@verify.test`,
    'staff',
  )
  const browserTemp = await mkUser(
    orgV._id,
    dept._id,
    'Tom Temp',
    `btemp-${runId}@verify.test`,
    'staff',
  )
  const otherUser = await mkUser(
    orgOther._id,
    null,
    'Otto Other',
    `other-${runId}@verify.test`,
    'staff',
  )

  const adminEmail = `admin-${runId}@verify.test`
  const managerEmail = `mgr-${runId}@verify.test`
  const adminCookie = await login(adminEmail, PASS)

  // Fake per-section client IPs so the shared per-IP budgets don't collide.
  const IP = {
    deactivate: '203.0.113.10',
    password: '203.0.113.11',
    temp: '203.0.113.12',
    loginLimit: '203.0.113.31',
    registerLimit: '203.0.113.30',
    passwordLimit: '203.0.113.32',
  }
  const rateKeys = [
    `login:${IP.loginLimit}`,
    `register:${IP.registerLimit}`,
    `password-change:${IP.passwordLimit}`,
    `password-change:${IP.password}`,
    `password-change:${IP.temp}`,
    `verify7a:${runId}`,
  ]

  // ---------- A. Deactivated users ----------
  console.log('\n--- A. Deactivated user lockout ---')

  const deactCookie = await login(`deact-${runId}@verify.test`, PASS)
  const beforeDeact = await api(deactCookie, 'GET', '/api/expenses')
  check('active user can use the API', beforeDeact.status === 200)

  await User.updateOne({ _id: deact._id }, { isActive: false })

  const apiAfter = await api(deactCookie, 'GET', '/api/expenses')
  check(
    'deactivated user gets 401 on the API immediately',
    apiAfter.status === 401,
    apiAfter.status,
  )
  check(
    'deactivated API call clears the session cookie',
    clearsCookie(apiAfter.headers),
  )

  const pageAfter = await api(deactCookie, 'GET', '/dashboard')
  check(
    'deactivated page load redirects to the session-expired handler',
    redirectedTo(pageAfter, '/api/auth/session-expired'),
    { status: pageAfter.status, location: pageAfter.headers.get('location') },
  )

  const expired = await api(deactCookie, 'GET', '/api/auth/session-expired')
  check(
    'session-expired handler clears the cookie and sends to /login?reason=deactivated',
    isRedirect(expired.status) &&
      (expired.headers.get('location') ?? '').includes(
        '/login?reason=deactivated',
      ) &&
      clearsCookie(expired.headers),
    { status: expired.status, location: expired.headers.get('location') },
  )

  const loginPage = await api(null, 'GET', '/login?reason=deactivated')
  check(
    'login page still renders for a deactivated user',
    loginPage.status === 200,
  )

  // ---------- B. Change own password ----------
  console.log('\n--- B. Change own password (/account) ---')

  const pwEmail = `pw-${runId}@verify.test`
  const pwCookie = await login(pwEmail, PASS)
  const pwHeaders = { 'x-forwarded-for': IP.password }

  const accountPage = await api(pwCookie, 'GET', '/account')
  check(
    '/account renders for every role',
    accountPage.status === 200 && accountPage.text.includes('Current password'),
    accountPage.status,
  )

  const anonChange = await api(
    null,
    'POST',
    '/api/account/password',
    { currentPassword: PASS, newPassword: NEWPASS, confirmPassword: NEWPASS },
    pwHeaders,
  )
  check('password change without a session is 401', anonChange.status === 401)

  const wrongCurrent = await api(
    pwCookie,
    'POST',
    '/api/account/password',
    {
      currentPassword: 'NotMyPassword1!',
      newPassword: NEWPASS,
      confirmPassword: NEWPASS,
    },
    pwHeaders,
  )
  check(
    'wrong current password is rejected (400)',
    wrongCurrent.status === 400,
    wrongCurrent.json,
  )

  const mismatch = await api(
    pwCookie,
    'POST',
    '/api/account/password',
    {
      currentPassword: PASS,
      newPassword: NEWPASS,
      confirmPassword: 'Nope12345!',
    },
    pwHeaders,
  )
  check(
    'mismatched confirmation is a validation error (400)',
    mismatch.status === 400,
  )

  const tooShort = await api(
    pwCookie,
    'POST',
    '/api/account/password',
    { currentPassword: PASS, newPassword: 'short', confirmPassword: 'short' },
    pwHeaders,
  )
  check(
    'short new password is a validation error (400)',
    tooShort.status === 400,
  )

  const changed = await api(
    pwCookie,
    'POST',
    '/api/account/password',
    { currentPassword: PASS, newPassword: NEWPASS, confirmPassword: NEWPASS },
    pwHeaders,
  )
  check('password change succeeds', changed.status === 200, changed.json)
  check(
    'password change response never contains password material',
    !changed.text.includes('$2b$') && !changed.text.includes('passwordHash'),
  )

  const oldLogin = await loginFull(pwEmail, PASS)
  check('the old password no longer signs in', oldLogin.status === 401)

  const newLogin = await loginFull(pwEmail, NEWPASS)
  check(
    'the new password signs in',
    newLogin.status === 200 && !!newLogin.cookie,
  )

  const changeAudit = await AuditLog.findOne({
    organizationId: orgV._id,
    userId: pwUser._id,
    entity: 'User',
    action: 'update',
    entityId: pwUser._id,
  }).lean()
  check('password change writes an audit entry', !!changeAudit)

  // ---------- C. Admin temporary password ----------
  console.log('\n--- C. Admin temporary password + forced change ---')

  const reset = await api(
    adminCookie,
    'POST',
    `/api/admin/users/${manager._id}/reset-password`,
    {},
  )
  const temp = (reset.json as { temporaryPassword?: string } | null)
    ?.temporaryPassword
  check(
    'admin reset returns a generated temporary password',
    reset.status === 200 && typeof temp === 'string' && temp.length >= 8,
    reset.status,
  )
  check(
    'reset response never contains password material',
    !reset.text.includes('$2b$') && !reset.text.includes('passwordHash'),
  )

  const managerDoc = await User.findById(manager._id)
    .select('+passwordHash')
    .lean<{ mustChangePassword: boolean; passwordHash: string } | null>()
  check(
    'reset sets mustChangePassword and stores a new hash',
    managerDoc?.mustChangePassword === true && managerDoc.passwordHash !== hash,
  )
  const resetAudit = await AuditLog.findOne({
    organizationId: orgV._id,
    userId: admin._id,
    entity: 'User',
    entityId: manager._id,
    action: 'update',
  }).lean()
  check('password reset writes an audit entry', !!resetAudit)

  const selfReset = await api(
    adminCookie,
    'POST',
    `/api/admin/users/${admin._id}/reset-password`,
    {},
  )
  check('admin cannot reset their own password (400)', selfReset.status === 400)

  const crossTenantReset = await api(
    adminCookie,
    'POST',
    `/api/admin/users/${otherUser._id}/reset-password`,
    {},
  )
  check(
    'reset of another organization user is 404',
    crossTenantReset.status === 404,
  )

  const staffReset = await api(
    pwCookie,
    'POST',
    `/api/admin/users/${manager._id}/reset-password`,
    {},
  )
  check('staff cannot reset passwords (403)', staffReset.status === 403)

  const mgrLogin = await loginFull(managerEmail, temp as string)
  check(
    'temporary password signs in and reports mustChangePassword',
    mgrLogin.status === 200 &&
      (mgrLogin.json?.user as { mustChangePassword?: boolean } | undefined)
        ?.mustChangePassword === true,
    mgrLogin.json,
  )
  const mgrCookie = mgrLogin.cookie as string

  const mgrApi = await api(mgrCookie, 'GET', '/api/expenses')
  check(
    'pending change blocks every API (403)',
    mgrApi.status === 403 && mgrApi.json?.error === 'Password change required',
    mgrApi.json,
  )
  const mgrApiBudgets = await api(mgrCookie, 'GET', '/api/budgets')
  check('pending change blocks budgets too (403)', mgrApiBudgets.status === 403)
  const mgrMe = await api(mgrCookie, 'GET', '/api/auth/me')
  check('pending change blocks /api/auth/me (403)', mgrMe.status === 403)

  const mgrPage = await api(mgrCookie, 'GET', '/dashboard')
  check(
    'pending change redirects pages to /account/change-password',
    redirectedTo(mgrPage, '/account/change-password'),
    { status: mgrPage.status, location: mgrPage.headers.get('location') },
  )
  const mgrAccount = await api(mgrCookie, 'GET', '/account')
  check(
    'the voluntary account page redirects too',
    redirectedTo(mgrAccount, '/account/change-password'),
    { status: mgrAccount.status },
  )
  const forcedPage = await api(mgrCookie, 'GET', '/account/change-password')
  check(
    'the forced change page renders',
    forcedPage.status === 200 && forcedPage.text.includes('temporary password'),
    forcedPage.status,
  )

  const forcedHeaders = { 'x-forwarded-for': IP.temp }
  const forcedWrong = await api(
    mgrCookie,
    'POST',
    '/api/account/password',
    {
      currentPassword: 'NotTheTemp1!',
      newPassword: NEWPASS,
      confirmPassword: NEWPASS,
    },
    forcedHeaders,
  )
  check(
    'the forced page still verifies the current (temporary) password',
    forcedWrong.status === 400,
  )

  const forcedOk = await api(
    mgrCookie,
    'POST',
    '/api/account/password',
    {
      currentPassword: temp,
      newPassword: NEWPASS,
      confirmPassword: NEWPASS,
    },
    forcedHeaders,
  )
  check('changing the temporary password succeeds', forcedOk.status === 200)

  const mgrAgentAfter = await api(mgrCookie, 'GET', '/api/expenses')
  check(
    'after the change the API works again',
    mgrAgentAfter.status === 200,
    mgrAgentAfter.status,
  )
  const mgrAfter = await User.findById(manager._id).lean<{
    mustChangePassword: boolean
  } | null>()
  check('mustChangePassword is cleared', mgrAfter?.mustChangePassword === false)

  // ---------- D. MongoDB rate limiter ----------
  console.log('\n--- D. MongoDB rate limiter ---')

  await waitForWindow()
  let allowedCount = 0
  for (let i = 0; i < 5; i++) {
    if (
      (
        await api(
          null,
          'POST',
          '/api/auth/login',
          { email: adminEmail, password: 'nope' },
          { 'x-forwarded-for': IP.loginLimit },
        )
      ).status === 401
    ) {
      allowedCount++
    }
  }
  check('login: the first five attempts are processed', allowedCount === 5)
  const blockedLogin = await api(
    null,
    'POST',
    '/api/auth/login',
    { email: adminEmail, password: 'nope' },
    { 'x-forwarded-for': IP.loginLimit },
  )
  check(
    'login: the sixth attempt in the window is 429',
    blockedLogin.status === 429,
    blockedLogin.status,
  )

  await waitForWindow()
  let registerProcessed = 0
  for (let i = 0; i < 5; i++) {
    const res = await api(
      null,
      'POST',
      '/api/auth/register',
      { organizationName: 'X', name: 'X', email: 'bad', password: 'short' },
      { 'x-forwarded-for': IP.registerLimit },
    )
    if (res.status === 400) registerProcessed++
  }
  check(
    'register: the first five attempts are processed',
    registerProcessed === 5,
  )
  const blockedRegister = await api(
    null,
    'POST',
    '/api/auth/register',
    { organizationName: 'X', name: 'X', email: 'bad', password: 'short' },
    { 'x-forwarded-for': IP.registerLimit },
  )
  check(
    'register: the sixth attempt in the window is 429',
    blockedRegister.status === 429,
    blockedRegister.status,
  )

  await waitForWindow()
  let passwordProcessed = 0
  for (let i = 0; i < 5; i++) {
    const res = await api(
      null,
      'POST',
      '/api/account/password',
      { currentPassword: 'x', newPassword: NEWPASS, confirmPassword: NEWPASS },
      { 'x-forwarded-for': IP.passwordLimit },
    )
    if (res.status === 401) passwordProcessed++
  }
  check(
    'password change: the first five attempts are processed',
    passwordProcessed === 5,
  )
  const blockedPassword = await api(
    null,
    'POST',
    '/api/account/password',
    { currentPassword: 'x', newPassword: NEWPASS, confirmPassword: NEWPASS },
    { 'x-forwarded-for': IP.passwordLimit },
  )
  check(
    'password change: the sixth attempt in the window is 429',
    blockedPassword.status === 429,
    blockedPassword.status,
  )

  // The counter must be in MongoDB, not in module memory: a fresh process
  // (i.e. a second server instance, no module state) must see this process's
  // count. First process is the script itself, second is the probe.
  await waitForWindow(20_000) // two probe spawns plus five attempts
  const probeKey = `verify7a:${runId}`
  const probe = (key: string) =>
    spawnSync('npx', ['tsx', 'scripts/rate-limit-probe.mts', key], {
      encoding: 'utf8',
    })

  const firstProbe = probe(probeKey)
  check(
    'a fresh process can spend its first attempt',
    firstProbe.status === 0 && (firstProbe.stdout ?? '').includes('ALLOWED'),
    {
      status: firstProbe.status,
      stdout: firstProbe.stdout,
      stderr: firstProbe.stderr?.slice(0, 300),
    },
  )

  // Spend the rest of the window in THIS process (four more = five total).
  for (let i = 0; i < 4; i++) await checkRateLimit(probeKey)
  const sixth = await checkRateLimit(probeKey)
  check('this process is blocked after five attempts', sixth === false)

  const secondProbe = probe(probeKey)
  check(
    'a second process (fresh module state) sees the same exhausted window',
    secondProbe.status === 2 && (secondProbe.stdout ?? '').includes('BLOCKED'),
    {
      status: secondProbe.status,
      stdout: secondProbe.stdout,
      stderr: secondProbe.stderr?.slice(0, 300),
    },
  )

  const probeDoc = await RateLimit.findOne({ key: probeKey }).lean<{
    count: number
    windowStart: Date
  } | null>()
  check(
    'the counter document lives in the RateLimit collection',
    !!probeDoc && probeDoc.count >= 6 && !!probeDoc.windowStart,
    probeDoc,
  )

  // ---------- E. Sliding session renewal ----------
  console.log('\n--- E. Sliding session renewal ---')

  const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
  const now = Math.floor(Date.now() / 1000)

  async function craftToken(opts: {
    userId: string
    role: Role
    issuedAt: number
    iat: number
    exp: number
  }): Promise<string> {
    return new SignJWT({
      organizationId: String(orgV._id),
      departmentId: null,
      role: opts.role,
      issuedAt: opts.issuedAt,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(opts.userId)
      .setIssuedAt(opts.iat)
      .setExpirationTime(opts.exp)
      .sign(secret)
  }

  const renewIssuedAt = now - 7 * 60 * 60
  const renewToken = await craftToken({
    userId: String(admin._id),
    role: 'admin',
    issuedAt: renewIssuedAt,
    iat: renewIssuedAt,
    exp: now + 60 * 60,
  })
  const renewedRes = await api(`session=${renewToken}`, 'GET', '/api/auth/me')
  const renewedCookie = sessionCookie(renewedRes.headers)
  const renewedClaims = renewedCookie
    ? await verifyToken(renewedCookie.split(';')[0].slice('session='.length))
    : null
  check(
    'a token with under 2 hours left is renewed on the next API call',
    renewedRes.status === 200 && !!renewedCookie,
    renewedRes.status,
  )
  check(
    'the renewed token lasts 8 hours and keeps the original issuedAt',
    !!renewedClaims &&
      Math.abs(renewedClaims.expiresAt - (now + 8 * 60 * 60)) <= 120 &&
      renewedClaims.issuedAt === renewIssuedAt,
    renewedClaims,
  )

  const cappedIssuedAt = now - (6 * 24 * 60 + 23 * 60) * 60
  const cappedToken = await craftToken({
    userId: String(admin._id),
    role: 'admin',
    issuedAt: cappedIssuedAt,
    iat: now - 7 * 60 * 60,
    exp: now + 60 * 60,
  })
  const cappedRes = await api(`session=${cappedToken}`, 'GET', '/api/auth/me')
  check(
    'a session near the 7-day cap still works',
    cappedRes.status === 200,
    cappedRes.status,
  )
  check(
    'a renewal that would pass the 7-day cap is not issued',
    sessionCookie(cappedRes.headers) === null,
  )

  const freshToken = await craftToken({
    userId: String(admin._id),
    role: 'admin',
    issuedAt: now,
    iat: now,
    exp: now + 8 * 60 * 60,
  })
  const freshRes = await api(`session=${freshToken}`, 'GET', '/api/auth/me')
  check(
    'a fresh token is not replaced',
    freshRes.status === 200 && sessionCookie(freshRes.headers) === null,
  )

  // ---------- F. UI ----------
  console.log('\n--- F. UI (Playwright) ---')
  await uiChecks({
    browserDeactEmail: `bdeact-${runId}@verify.test`,
    browserTempEmail: `btemp-${runId}@verify.test`,
    browserDeactId: String(browserDeact._id),
    browserTempId: String(browserTemp._id),
    adminCookie,
  })

  // ---------- Cleanup ----------
  await cleanup([orgV._id, orgOther._id], rateKeys)
  const leftovers = await Promise.all([
    User.countDocuments({ organizationId: { $in: [orgV._id, orgOther._id] } }),
    RateLimit.countDocuments({ key: { $in: rateKeys } }),
  ])
  console.log(
    `INFO  cleanup: leftover users/rate-limit docs=${leftovers.join('/')}`,
  )
  await mongoose.disconnect()

  console.log(`\nRESULT  ${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.log('FAILURES:\n' + failures.map((f) => ` - ${f}`).join('\n'))
    process.exitCode = 1
  }
}

async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('form button[type=submit]')
      return !!btn && Object.keys(btn).some((k) => k.startsWith('__reactProps'))
    },
    undefined,
    { timeout: 20_000 },
  )
}

async function uiChecks(opts: {
  browserDeactEmail: string
  browserTempEmail: string
  browserDeactId: string
  browserTempId: string
  adminCookie: string
}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []
  const failedRequests: string[] = []

  const newPage = async (email: string, password: string) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      if (m.text().includes('Failed to load resource')) {
        failedRequests.push(m.text())
        return
      }
      errors.push(`[console] ${m.text()}`)
    })
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await waitForHydration(page)
    await page.fill('input[id=email]', email)
    await page.fill('input[id=password]', password)
    await page.getByRole('button', { name: /sign in/i }).click()
    return page
  }

  try {
    // Deactivated user: signed in, then deactivated, then a page load.
    const deactPage = await newPage(opts.browserDeactEmail, PASS)
    await deactPage.waitForURL('**/dashboard', { timeout: 20_000 })

    await User.updateOne({ _id: opts.browserDeactId }, { isActive: false })
    await deactPage.reload({ waitUntil: 'domcontentloaded' })
    await deactPage.waitForURL(/\/login\?reason=deactivated/, {
      timeout: 20_000,
    })
    check('UI: a deactivated user is signed out on the next page load', true)
    check(
      'UI: the login page explains the deactivation',
      await deactPage
        .getByText(/deactivated/i)
        .first()
        .isVisible(),
    )

    // Temporary password: login lands on the forced change page.
    const reset = await api(
      opts.adminCookie,
      'POST',
      `/api/admin/users/${opts.browserTempId}/reset-password`,
      {},
    )
    const temp = (reset.json as { temporaryPassword?: string } | null)
      ?.temporaryPassword as string
    check('UI: admin reset provides a temporary password', !!temp)

    const tempPage = await newPage(opts.browserTempEmail, temp)
    await tempPage.waitForURL(/\/account\/change-password/, {
      timeout: 20_000,
    })
    check(
      'UI: login with a temporary password opens the forced change page',
      true,
    )

    await tempPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
    await tempPage.waitForURL(/\/account\/change-password/, {
      timeout: 20_000,
    })
    check('UI: other pages bounce back to the forced change page', true)

    await waitForHydration(tempPage)
    await tempPage.fill('#currentPassword', 'NotTheTemp1!')
    await tempPage.fill('#newPassword', 'BrowserNew123!')
    await tempPage.fill('#confirmPassword', 'BrowserNew123!')
    await tempPage.getByRole('button', { name: /change password/i }).click()
    await tempPage
      .getByRole('alert')
      .filter({ hasText: /current password is incorrect/i })
      .waitFor({ timeout: 20_000 })
    check('UI: a wrong current password shows an error', true)

    await tempPage.fill('#currentPassword', temp)
    await tempPage.getByRole('button', { name: /change password/i }).click()
    await tempPage.waitForURL('**/dashboard', { timeout: 20_000 })
    check('UI: changing the temporary password lands on the dashboard', true)

    await tempPage.getByRole('link', { name: 'Account' }).click()
    await tempPage.waitForURL(/\/account$/, { timeout: 20_000 })
    check(
      'UI: the header Account link opens /account',
      await tempPage
        .getByRole('button', { name: /change password/i })
        .isVisible(),
    )

    check('UI: no uncaught page/console errors', errors.length === 0, errors)
    const unexpected = failedRequests.filter(
      (t) => !/status of (400|401|403|409)/.test(t),
    )
    check(
      'UI: only the deliberate 400/401/403 responses were logged as failed requests',
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
