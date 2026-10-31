import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import {
  MarkNotificationsReadSchema,
  NotificationQuerySchema,
} from '@/schemas/notification'
import {
  listNotifications,
  markNotificationsRead,
} from '@/services/notification-service'

// GET  /api/notifications — the caller's own paginated inbox.
export async function GET(req: NextRequest) {
  const guard = await requireSession()
  if (!guard.ok) return guard.response

  // An empty `?page=` from a cleared filter means "use the default".
  const params = Object.fromEntries(req.nextUrl.searchParams)
  for (const key of Object.keys(params)) {
    if (params[key] === '') delete params[key]
  }

  const parsed = NotificationQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(
      await listNotifications(guard.session, parsed.data),
    )
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/notifications — mark the given ids (or all unread) as read.
export async function POST(req: NextRequest) {
  const guard = await requireSession()
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = MarkNotificationsReadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(
      await markNotificationsRead(guard.session, parsed.data),
    )
  } catch (err) {
    return errorResponse(err)
  }
}
