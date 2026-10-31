import { NextResponse, type NextRequest } from 'next/server'
import { LoginSchema } from '@/schemas/auth'
import { authenticate } from '@/services/auth-service'
import { setSession } from '@/lib/session'
import { checkRateLimit, resetRateLimit, clientIp } from '@/lib/rate-limit'
import { z } from 'zod'

export async function POST(req: NextRequest) {
  // Rate limit by IP before doing any work.
  const ip = clientIp(req.headers)
  if (!(await checkRateLimit(`login:${ip}`))) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a minute.' },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  const user = await authenticate(parsed.data.email, parsed.data.password)

  // Generic error — never reveal whether the email exists.
  if (!user) {
    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 },
    )
  }

  await resetRateLimit(`login:${ip}`)

  await setSession({
    userId: user.id,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    role: user.role,
  })

  // The client sends a user with a temporary password straight to the
  // forced change page (Phase 7A).
  return NextResponse.json({ user })
}
