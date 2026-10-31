import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { archiveDepartment } from '@/services/admin-service'

type RouteContext = { params: Promise<{ id: string }> }

// POST /api/admin/departments/:id/archive — retire a department without losing
// its name in historical reports. Reversible.
export async function POST(_req: Request, ctx: RouteContext) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    const department = await archiveDepartment(guard.session, id)
    return NextResponse.json({ department })
  } catch (err) {
    return errorResponse(err)
  }
}
