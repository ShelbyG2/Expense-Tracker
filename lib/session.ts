// Reads/writes the session cookie.
// Cookie flags: HTTP-only, SameSite=Lax, Secure in production.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  SESSION_SECONDS,
  shouldRenewToken,
  signSession,
  verifySession,
  verifyToken,
  type Session,
} from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { User } from '@/models/user'

export const SESSION_COOKIE = 'session'

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  }
}

type FreshSession =
  | { status: 'active'; session: Session }
  | { status: 'inactive' }
  | { status: 'deleted' }

// Re-reads role, department, active status and the must-change flag from the
// database so admin changes (Phase 5 roles/departments, Phase 7A deactivation
// and password resets) take effect before the 8-hour token expires.
async function refreshFromDb(session: Session): Promise<FreshSession> {
  await connectDB()
  const user = await User.findOne({
    _id: session.userId,
    organizationId: session.organizationId,
  })
    .select('role departmentId isActive mustChangePassword')
    .lean<{
      role: Session['role']
      departmentId?: unknown
      isActive: boolean
      mustChangePassword: boolean
    } | null>()

  // A deleted user is signed out exactly like a deactivated one: the old
  // lib/guard.ts 401'd them on every call, and a token must never outlive the
  // account it names.
  if (!user) return { status: 'deleted' }
  if (!user.isActive) return { status: 'inactive' }

  return {
    status: 'active',
    session: {
      ...session,
      role: user.role,
      departmentId: user.departmentId ? String(user.departmentId) : null,
      mustChangePassword: user.mustChangePassword,
    },
  }
}

// Page-facing session (server components). Render cannot clear cookies, so a
// deactivated user is forwarded to /api/auth/session-expired — a route handler
// that clears the cookie and lands on /login?reason=deactivated. Redirecting
// straight to /login would loop: proxy only verifies the JWT, so the still-
// valid cookie would bounce back to the protected page forever.
export async function getSession(): Promise<Session | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await verifySession(token)
  if (!session) return null

  const fresh = await refreshFromDb(session)
  if (fresh.status !== 'active') redirect('/api/auth/session-expired')
  return fresh.session
}

// Route-handler session (lib/guard.ts). Unlike render, a route handler may
// write cookies, so this variant also ends a deactivated user's session
// immediately and slides the session renewal: a valid token with under 2 hours
// left is replaced by a fresh 8-hour token, never past the 7-day absolute max.
export async function getApiSession(): Promise<Session | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const verified = await verifyToken(token)
  if (!verified) return null

  const fresh = await refreshFromDb(verified.session)
  if (fresh.status !== 'active') {
    await clearSession()
    return null
  }
  const session = fresh.session

  if (shouldRenewToken(verified)) {
    const renewed = await signSession(session, {
      issuedAt: verified.issuedAt,
    })
    store.set(SESSION_COOKIE, renewed, cookieOptions(SESSION_SECONDS))
  }
  return session
}

// Must be called from a route handler or server action (writes are not allowed
// during render of a server component).
export async function setSession(session: Session): Promise<void> {
  const token = await signSession(session)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS))
}

export async function clearSession(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', cookieOptions(0))
}
