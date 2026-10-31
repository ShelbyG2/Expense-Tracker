import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { DepartmentNameSchema } from '@/schemas/admin'
import { createDepartment, listDepartments } from '@/services/admin-service'

// GET /api/admin/departments — list the organization's departments (admin only).
export async function GET() {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  try {
    const departments = await listDepartments(guard.session)
    return NextResponse.json({ items: departments })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/admin/departments — create a department in the caller's org.
export async function POST(req: NextRequest) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

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
    const department = await createDepartment(guard.session, parsed.data)
    return NextResponse.json({ department }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
