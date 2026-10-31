import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { UpdateExpenseSchema } from '@/schemas/expense'
import {
  deleteExpense,
  getExpense,
  updateExpense,
} from '@/services/expense-service'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/expenses/:id — 404 when the expense is outside the caller's scope.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('admin', 'manager', 'staff')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    const expense = await getExpense(guard.session, id)
    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }
    return NextResponse.json({ expense })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/expenses/:id — owner only, pending only (rule 4).
// Staff and managers may edit their own expenses; admins stay read-only.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('staff', 'manager')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateExpenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const expense = await updateExpense(guard.session, id, parsed.data)
    return NextResponse.json({ expense })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/expenses/:id — owner only, pending only (rule 4).
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('staff', 'manager')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    await deleteExpense(guard.session, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
