import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { CreateUserSchema } from '@/schemas/admin'
import { createUser, listUsers } from '@/services/admin-service'

// GET /api/admin/users — list the organization's users (admin only).
export async function GET() {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  try {
    const users = await listUsers(guard.session)
    return NextResponse.json({ items: users })
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/admin/users — create a user in the caller's organization.
export async function POST(req: NextRequest) {
  const guard = await requireRole('admin')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const user = await createUser(guard.session, parsed.data)
    return NextResponse.json({ user }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
