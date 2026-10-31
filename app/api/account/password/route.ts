import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { ChangePasswordSchema } from '@/schemas/auth'
import { changeOwnPassword } from '@/services/auth-service'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'

// POST /api/account/password — change your own password (all roles).
// The current password is required, so a stolen session cannot lock the real
// owner out. Clears the admin-set mustChangePassword flag on success.
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers)
  if (!(await checkRateLimit(`password-change:${ip}`))) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a minute.' },
      { status: 429 },
    )
  }

  const guard = await requireSession({ allowPendingPasswordChange: true })
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    await changeOwnPassword(guard.session, parsed.data)
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
