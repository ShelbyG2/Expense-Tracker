import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { UpdateSettingsSchema } from '@/schemas/settings'
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from '@/services/organization-service'

// GET /api/admin/settings — the organization's configurable settings.
export async function GET() {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  try {
    return NextResponse.json({
      settings: await getOrganizationSettings(guard.session),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/admin/settings — currently only the warning threshold.
export async function PATCH(req: NextRequest) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json({
      settings: await updateOrganizationSettings(guard.session, parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
