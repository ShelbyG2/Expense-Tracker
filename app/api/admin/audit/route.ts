import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { AuditQuerySchema } from '@/schemas/audit'
import { listAuditLogs } from '@/services/audit-service'

// GET /api/admin/audit — read-only audit trail for the caller's organization.
// Filters: userId, entity, action, from, to; paging: page, pageSize.
export async function GET(req: NextRequest) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  const parsed = AuditQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const result = await listAuditLogs(guard.session, parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
