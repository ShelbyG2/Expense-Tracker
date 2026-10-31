// JWT session tokens, signed with jose (HS256).
// The token is stored in an HTTP-only cookie (see lib/session.ts).

import { SignJWT, jwtVerify } from 'jose'

export const SESSION_SECONDS = 60 * 60 * 8 // 8 hour expiry
// Sliding renewal: a token with less than this much time left is replaced
// with a fresh 8-hour token on the next authenticated API call.
const RENEW_BELOW_SECONDS = 60 * 60 * 2
// Absolute cap: no renewal may push a session past 7 days from first issue.
export const ABSOLUTE_SESSION_MAX_SECONDS = 60 * 60 * 24 * 7

export type Session = {
  userId: string
  organizationId: string
  departmentId: string | null
  role: 'admin' | 'manager' | 'staff'
  // DB-fresh flag, never part of the JWT: set by getSession/getApiSession.
  mustChangePassword?: boolean
}

// A verified token plus the timing claims renewal decisions need.
export type VerifiedToken = {
  session: Session
  issuedAt: number // seconds — first issue, guards the 7-day absolute max
  expiresAt: number // seconds
}

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('Missing JWT_SECRET environment variable')
  }
  return new TextEncoder().encode(secret)
}

// `issuedAt` carries the first-issue time across renewals; `iat`/`exp` are
// refreshed on every renewal, so only issuedAt can enforce the absolute cap.
export async function signSession(
  session: Session,
  opts?: { issuedAt?: number },
): Promise<string> {
  const issuedAt = opts?.issuedAt ?? Math.floor(Date.now() / 1000)

  return new SignJWT({
    organizationId: session.organizationId,
    departmentId: session.departmentId,
    role: session.role,
    issuedAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secretKey())
}

// Returns the session and its timing claims, or null if invalid/expired.
export async function verifyToken(
  token: string,
): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
    })
    if (!payload.sub) return null
    const role = payload.role
    if (role !== 'admin' && role !== 'manager' && role !== 'staff') return null

    const now = Math.floor(Date.now() / 1000)
    const iat = typeof payload.iat === 'number' ? payload.iat : now
    // Tokens minted before Phase 7A carry no issuedAt claim: their iat was
    // the first issue, so fall back to it (they simply age out a bit sooner).
    const issuedAt =
      typeof payload.issuedAt === 'number' ? payload.issuedAt : iat

    return {
      session: {
        userId: payload.sub,
        organizationId: String(payload.organizationId),
        departmentId: payload.departmentId
          ? String(payload.departmentId)
          : null,
        role,
      },
      issuedAt,
      expiresAt:
        typeof payload.exp === 'number' ? payload.exp : iat + SESSION_SECONDS,
    }
  } catch {
    return null
  }
}

// Returns the session, or null if the token is invalid/expired.
export async function verifySession(token: string): Promise<Session | null> {
  const verified = await verifyToken(token)
  return verified?.session ?? null
}

// Sliding session: renew only when less than 2 hours remain, and never issue
// a token whose expiry would land past 7 days from the first issue.
export function shouldRenewToken(
  token: VerifiedToken,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (token.expiresAt - nowSeconds >= RENEW_BELOW_SECONDS) return false
  return (
    token.issuedAt + ABSOLUTE_SESSION_MAX_SECONDS >=
    nowSeconds + SESSION_SECONDS
  )
}
