// Seed verification (Phase 6): proves the `npm run seed` demo data shows the
// promised MIS outputs in the browser: the manager dashboard alert banner
// (one ok / one warning / one exceeded category), the report figures, the
// admin's organization-wide view and the staff department budget table.
//
// Usage: npx tsx scripts/verify-seed.mts   (dev server must be running,
// after `npm run seed`)
//
// Reads the seeded Demo Organization only; creates and removes nothing.

import { loadEnvFile } from 'node:process'

loadEnvFile('.env')
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development'

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3000'
const PASS = 'Password123!'

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

async function main() {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []
  const failedRequests: number[] = []

  const newPage = async (email: string) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
    })
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(res.status())
    })
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    // Wait for hydration; an early click submits the native form instead.
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
    // Manager: the seeded Operations figures drive the alert banner.
    const manager = await newPage('manager@example.com')
    const banner = manager.locator('[aria-label="Budget alerts"]')
    await banner.waitFor({ timeout: 20_000 })
    const bannerText = await banner.innerText()
    check(
      'seeded manager dashboard shows the warning and exceeded alerts',
      bannerText.includes('Supplies') &&
        bannerText.includes('125.0%') &&
        bannerText.includes('Meals') &&
        bannerText.includes('84.0%'),
      bannerText,
    )

    // Manager reports: 750/1000 = 75.0% ok, 420/500 = 84.0% warning.
    await manager.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await manager.locator('table').first().waitFor({ timeout: 20_000 })
    const table = await manager.locator('table').first().innerText()
    check(
      'seeded budget vs actual rows match the seed fixtures',
      table.includes('Transport') &&
        table.includes('750.00') &&
        table.includes('1,000.00') &&
        table.includes('75.0%') &&
        table.includes('Warning') &&
        table.includes('420.00') &&
        table.includes('84.0%'),
      table.slice(0, 600),
    )
    const body = await manager.locator('body').innerText()
    check(
      'seeded pending expenses show as awaiting approval',
      body.includes('180.00'),
      body.slice(0, 400),
    )

    // Staff: read-only department budget status for the seeded department.
    const staff = await newPage('staff@example.com')
    await staff.waitForTimeout(1000)
    const staffBody = await staff.locator('body').innerText()
    check(
      'seeded staff dashboard shows the department budget status',
      staffBody.includes('Transport') && staffBody.includes('750.00'),
      staffBody.slice(0, 400),
    )

    // Admin: reports span all three seeded departments.
    const admin = await newPage('admin@example.com')
    await admin.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await admin.locator('table').first().waitFor({ timeout: 20_000 })
    const adminTable = await admin.locator('table').first().innerText()
    check(
      'seeded admin report covers all three departments',
      adminTable.includes('Finance') && adminTable.includes('Outreach'),
      adminTable.slice(0, 600),
    )

    // Browsers log deliberate 4xx responses too; only JS errors matter.
    check('no uncaught page/console errors', errors.length === 0, errors)
    check(
      'no unexpected HTTP failures',
      failedRequests.every((s) => s === 401 || s === 403 || s === 404),
      failedRequests,
    )
  } catch (err) {
    check(`seed UI flow completed (${(err as Error).message})`, false)
  } finally {
    await browser.close()
  }

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.log('FAILURES:\n' + failures.map((f) => ` - ${f}`).join('\n'))
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('VERIFY ERROR:', err)
  process.exit(1)
})
