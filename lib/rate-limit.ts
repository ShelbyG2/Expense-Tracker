// MongoDB-backed fixed-window rate limiter (Phase 7A, replaces the in-memory
// Map). The counter lives in the RateLimit collection, so the limit holds
// across server instances and survives restarts.
//
// The interface is unchanged apart from being async — call sites only gained
// an `await`:
//   if (!(await checkRateLimit(`login:${ip}`))) return 429
//   await resetRateLimit(`login:${ip}`) // after a successful attempt

import { connectDB } from '@/lib/db'
import {
  RateLimit,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
} from '@/models/rate-limit'

const WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000
const DUPLICATE_KEY = 11000

// Aligned window start so every instance computes the same bucket.
function currentWindowStart(now = Date.now()): Date {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS)
}

// Best-effort client IP for per-IP keys.
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

// Counts one attempt and returns false once the key has exhausted the window.
export async function checkRateLimit(key: string): Promise<boolean> {
  await connectDB()
  const windowStart = currentWindowStart()

  try {
    const doc = await RateLimit.findOneAndUpdate(
      { key, windowStart },
      { $inc: { count: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    return (doc?.count ?? 1) <= RATE_LIMIT_MAX_ATTEMPTS
  } catch (err) {
    // Two concurrent first attempts in the same window: one loses the
    // insert race. The document now exists, so count it instead.
    if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err
    const doc = await RateLimit.findOneAndUpdate(
      { key, windowStart },
      { $inc: { count: 1 } },
      { new: true },
    )
    return (doc?.count ?? 1) <= RATE_LIMIT_MAX_ATTEMPTS
  }
}

// Clears the current window for a key (after a successful login) so a
// legitimate user isn't locked out by their own earlier typos.
export async function resetRateLimit(key: string): Promise<void> {
  await connectDB()
  await RateLimit.deleteOne({ key, windowStart: currentWindowStart() })
}
