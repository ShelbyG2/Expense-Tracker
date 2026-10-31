import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { unarchiveDepartment } from '@/services/admin-service'

type RouteContext = { params: Promise<{ id: string }> }

// POST /api/admin/departments/:id/unarchive — make an archived department
// active again so it can receive users, budgets and expenses.
export async function POST(_req: Request, ctx: RouteContext) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    const department = await unarchiveDepartment(guard.session, id)
    return NextResponse.json({ department })
  } catch (err) {
    return errorResponse(err)
  }
}
