import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { CreateExpenseSchema, ExpenseListQuerySchema } from '@/schemas/expense'
import { createExpense, listExpenses } from '@/services/expense-service'

// GET /api/expenses — role-scoped list with filters, sorting and pagination.
export async function GET(req: NextRequest) {
  const guard = await requireRole('admin', 'manager', 'staff')
  if (!guard.ok) return guard.response

  const params = Object.fromEntries(req.nextUrl.searchParams)
  // `?category=` from an empty form select means "no filter", not invalid input.
  for (const key of Object.keys(params)) {
    if (params[key] === '') delete params[key]
  }

  const parsed = ExpenseListQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await listExpenses(guard.session, parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}

// POST /api/expenses — staff and managers record their own expenses.
export async function POST(req: NextRequest) {
  const guard = await requireRole('staff', 'manager')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateExpenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    const expense = await createExpense(guard.session, parsed.data)
    return NextResponse.json({ expense }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
