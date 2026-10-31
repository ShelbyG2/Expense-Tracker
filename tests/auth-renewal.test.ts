import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import {
  ABSOLUTE_SESSION_MAX_SECONDS,
  SESSION_SECONDS,
  shouldRenewToken,
  signSession,
  verifyToken,
  type Session,
  type VerifiedToken,
} from '@/lib/auth'

const session: Session = {
  userId: 'u1',
  organizationId: 'o1',
  departmentId: null,
  role: 'manager',
}

// Token timing fixture: expiresAt = issuedAt + 8h.
function token(overrides: Partial<VerifiedToken> = {}): VerifiedToken {
  const issuedAt = 1_000_000
  return {
    session,
    issuedAt,
    expiresAt: issuedAt + SESSION_SECONDS,
    ...overrides,
  }
}

describe('shouldRenewToken', () => {
  it('does not renew a token with 2 hours or more left', () => {
    const t = token()
    // Just inside the window: 2h left exactly → no renewal.
    expect(shouldRenewToken(t, t.expiresAt - SESSION_SECONDS)).toBe(false)
    expect(shouldRenewToken(t, t.expiresAt - SESSION_SECONDS - 1)).toBe(false)
    expect(shouldRenewToken(t, t.issuedAt)).toBe(false)
  })

  it('renews a valid token with less than 2 hours left', () => {
    const t = token()
    expect(shouldRenewToken(t, t.expiresAt - 60 * 60)).toBe(true)
    expect(shouldRenewToken(t, t.expiresAt - 1)).toBe(true)
  })

  it('never renews past the 7-day absolute maximum', () => {
    // First issued 6 days 23 hours ago: a fresh 8h token would end past 7d.
    const issuedAt = 1_000_000
    const t = token({
      issuedAt,
      expiresAt: issuedAt + SESSION_SECONDS,
    })
    const now = issuedAt + 6 * 24 * 60 * 60 + 23 * 60 * 60
    expect(t.expiresAt - now).toBeLessThan(60 * 60 * 2)
    expect(shouldRenewToken(t, now)).toBe(false)
  })

  it('still renews while the renewal itself fits inside 7 days', () => {
    const issuedAt = 1_000_000
    const t = token({ issuedAt, expiresAt: issuedAt + SESSION_SECONDS })
    // 6 days 15 hours in: 8 more hours lands at 6d23h < 7d.
    const now = issuedAt + 6 * 24 * 60 * 60 + 15 * 60 * 60
    expect(shouldRenewToken(t, now)).toBe(true)
    expect(now + SESSION_SECONDS).toBeLessThanOrEqual(
      issuedAt + ABSOLUTE_SESSION_MAX_SECONDS,
    )
  })
})

describe('token issuedAt claim', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('survives sign/verify so renewal keeps the original first issue', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret')
    const firstIssue = Math.floor(Date.now() / 1000) - 1000

    const renewed = await signSession(session, { issuedAt: firstIssue })
    const verified = await verifyToken(renewed)
    expect(verified).not.toBeNull()
    expect(verified?.issuedAt).toBe(firstIssue)
    expect(verified?.session).toEqual(session)
  })

  it('defaults issuedAt to now when no first issue is given', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret')
    const before = Math.floor(Date.now() / 1000)
    const verified = await verifyToken(await signSession(session))
    expect(verified?.issuedAt).toBeGreaterThanOrEqual(before)
  })

  it('falls back to iat for tokens minted before Phase 7A', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret')
    const secret = new TextEncoder().encode('test-secret')
    const legacy = await new SignJWT({ organizationId: 'o1', role: 'staff' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuedAt()
      .setExpirationTime(`${SESSION_SECONDS}s`)
      .sign(secret)

    const verified = await verifyToken(legacy)
    expect(verified).not.toBeNull()
    if (!verified) return
    // exp = iat + 8h for that token, so issuedAt (from iat) equals exp - 8h.
    expect(verified.issuedAt).toBe(verified.expiresAt - SESSION_SECONDS)
  })
})
