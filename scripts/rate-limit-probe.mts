// Rate-limit probe for verify-phase7a.
//
// Runs in a FRESH process, so its module state (there is none: the counter
// lives in MongoDB) is the "second server instance" from the Phase 7A
// definition of done. Prints ALLOWED/BLOCKED and exits 0/2.
//
// Usage: npx tsx scripts/rate-limit-probe.mts <key>

import { loadEnvFile } from 'node:process'

loadEnvFile('.env')

const key = process.argv[2]
if (!key) {
  console.error('usage: npx tsx scripts/rate-limit-probe.mts <key>')
  process.exit(1)
}

const { checkRateLimit } = await import('../lib/rate-limit.ts')
const allowed = await checkRateLimit(key)
console.log(allowed ? 'ALLOWED' : 'BLOCKED')
process.exit(allowed ? 0 : 2)
