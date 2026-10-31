import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { DepartmentNameSchema } from '@/schemas/admin'
import { deleteDepartment, updateDepartment } from '@/services/admin-service'

type RouteContext = { params: Promise<{ id: string }> }

// PATCH /api/admin/departments/:id — rename a department.
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

  const parsed = DepartmentNameSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const department = await updateDepartment(guard.session, id, parsed.data)
    return NextResponse.json({ department })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/admin/departments/:id — refused while users/budgets reference it.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    await deleteDepartment(guard.session, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
