import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { BudgetListQuerySchema, CreateBudgetSchema } from '@/schemas/budget'
import { createBudget, listBudgets } from '@/services/budget-service'

// GET /api/budgets — managers see their department, admins the whole org.
export async function GET(req: NextRequest) {
  const guard = await requireRole('manager', 'admin')
  if (!guard.ok) return guard.response

  const params = Object.fromEntries(req.nextUrl.searchParams)
  // `?month=` from an empty form field means "no filter", not invalid input.
  for (const key of Object.keys(params)) {
    if (params[key] === '') delete params[key]
  }

  const parsed = BudgetListQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await listBudgets(guard.session, parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/budgets — managers set a budget for their own department.
export async function POST(req: NextRequest) {
  const guard = await requireRole('manager')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateBudgetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const budget = await createBudget(guard.session, parsed.data)
    return NextResponse.json({ budget }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
