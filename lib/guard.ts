// Server-side guard for API route handlers.
// Every protected route re-checks the session here — proxy only guards pages,
// so this is the authoritative check.

import { NextResponse } from 'next/server'
import { getApiSession } from '@/lib/session'
import type { Session } from '@/lib/auth'

export type GuardResult =
  { ok: true; session: Session } | { ok: false; response: NextResponse }

export type SessionOptions = {
  // Only the password-change route sets this: a user with a temporary
  // password may do nothing else until they change it (Phase 7A).
  allowPendingPasswordChange?: boolean
}

// Returns 401 if there is no valid session (or the user was deactivated —
// getApiSession clears their cookie then). Returns 403 while an admin-set
// temporary password is still in place.
export async function requireSession(
  options?: SessionOptions,
): Promise<GuardResult> {
  const session = await getApiSession()
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      ),
    }
  }

  if (session.mustChangePassword && !options?.allowPendingPasswordChange) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Password change required' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, session }
}

// Returns 401 if unauthenticated, 403 if the role isn't allowed.
// isActive and mustChangePassword are already enforced by requireSession.
export async function requireRole(
  ...roles: Session['role'][]
): Promise<GuardResult> {
  const guard = await requireSession()
  if (!guard.ok) return guard

  if (!roles.includes(guard.session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, session: guard.session }
}
