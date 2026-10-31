import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { UpdateBudgetSchema } from '@/schemas/budget'
import {
  deleteBudget,
  getBudget,
  updateBudget,
} from '@/services/budget-service'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/budgets/:id — 404 when the budget is outside the caller's scope.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('manager', 'admin')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    const budget = await getBudget(guard.session, id)
    if (!budget) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
    }
    return NextResponse.json({ budget })
  } catch (err) {
    return errorResponse(err)
  }
}

// PATCH /api/budgets/:id — managers only, own department only.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('manager')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateBudgetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const budget = await updateBudget(guard.session, id, parsed.data)
    return NextResponse.json({ budget })
  } catch (err) {
    return errorResponse(err)
  }
}

// DELETE /api/budgets/:id — managers only, own department only.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const guard = await requireRole('manager')
  if (!guard.ok) return guard.response

  const { id } = await ctx.params

  try {
    await deleteBudget(guard.session, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
