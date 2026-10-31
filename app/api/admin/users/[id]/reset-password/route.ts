import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { ResetPasswordSchema } from '@/schemas/admin'
import { resetUserPassword } from '@/services/admin-service'

type RouteContext = { params: Promise<{ id: string }> }

// POST /api/admin/users/:id/reset-password — set a temporary password.
// Body: {} to generate one, or { password } to supply it. Returns the
// temporary password once; the user must change it before they can use the
// app again. Out-of-org ids answer 404.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ResetPasswordSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const result = await resetUserPassword(guard.session, id, parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
