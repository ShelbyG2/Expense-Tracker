import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { UpdateUserSchema } from '@/schemas/admin'
import { updateUser } from '@/services/admin-service'

type RouteContext = { params: Promise<{ id: string }> }

// PATCH /api/admin/users/:id — change name/email/role/department/status.
// Out-of-org ids answer 404 so ids can't be probed across tenants.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const user = await updateUser(guard.session, id, parsed.data)
    return NextResponse.json({ user })
  } catch (err) {
    return errorResponse(err)
  }
}
