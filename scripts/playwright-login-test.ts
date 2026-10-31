/**
 * Playwright login reproduction (Phase 1 auth).
 *
 * Usage: npx tsx scripts/playwright-login-test.ts
 *
 * What it checks:
 *  1. /login renders.
 *  2. Fill the form with seeded admin@example.com / Password123!
 *  3. Submit; track every request/response/console entry.
 *  4. Assert the browser ended on /dashboard and holds a valid `session` cookie.
 *  5. Probe /api/auth/me with the browser's own cookie jar.
 */

import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const SEED_ADMIN = 'admin@example.com'
const SEED_PASS = 'Password123!'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const e: string[] = []
  page.on('console', (m) => e.push(`[console:${m.type()}] ${m.text()}`))
  page.on('pageerror', (err) => e.push(`[pageerror] ${err.message}`))
  page.on('requestfailed', (r) =>
    e.push(`[reqfail] ${r.url()} -> ${r.failure()?.errorText}`),
  )
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/') || u.includes('/dashboard') || u.includes('/login'))
      e.push(`[req] ${r.method()} ${u}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    const sc = r.status()
    if (
      u.includes('/api/') ||
      u.includes('/dashboard') ||
      u.includes('/login')
    ) {
      if (sc >= 400) e.push(`[resp:${sc}] ${u}`)
    }
  })

  const log = (label: string, v: string) => console.log(`${label} ${v}`)

  try {
    await page.goto(BASE + '/login', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    })
    const loginTitle = await page.textContent('h1')
    log('A) /login heading:', loginTitle?.trim() ?? '(empty)')

    await page.fill('input[id=email]', SEED_ADMIN)
    await page.fill('input[id=password]', SEED_PASS)
    const btn = page.getByRole('button', { name: /sign in/i })
    log('B) Sign-in button present:', await btn.isVisible())

    await btn.click()
    try {
      await page.waitForURL('/dashboard', { timeout: 15000 })
      log('C) Navigated to /dashboard:', true)
    } catch (err) {
      log('C) Did NOT navigate to /dashboard within 15s')
      if (err instanceof Error) log('C)   waitForURL reason:', err.message)
    }

    const after = await page.evaluate(() => window.location.pathname)
    log('D) Final URL path:', after)
    log('E) Stuck at /login (not /dashboard)?', after !== '/dashboard')

    const cookies = await page.context().cookies()
    const session = cookies.find((c) => c.name === 'session')
    log('F) session cookie present after login:', !!session)
    if (session) {
      log('G)  session value (head):', session.value.slice(0, 24) + '...')
      log('H)  cookie expires:', new Date(session.expires * 1000).toISOString())
    }

    const dashResp = await page.goto(BASE + '/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    })
    const dashTitle = await page.textContent('h1')
    log('I) /dashboard heading now:', dashTitle?.trim() ?? '(empty)')
    log('J) /dashboard response status:', dashResp?.status() ?? 'n/a')

    // 7) server-side probe using the SAME browser context cookies
    const me = await page.request.get(BASE + '/api/auth/me')
    log('K) API /me via context cookies ->', me.status())
    const meBody = await me.text()
    log('   /me body head:', meBody.slice(0, 140))

    log('L) TOTAL log entries:', e.length)
    e.forEach((x) => console.log('   ', x))

    await browser.close()
    if (after !== '/dashboard') process.exitCode = 1
  } catch (err: unknown) {
    console.error('PLAYWRIGHT ERROR:', (err as Error).message)
    await browser.close()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('UNCAUGHT:', err)
  process.exit(1)
})
