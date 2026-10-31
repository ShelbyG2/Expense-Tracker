import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/guard'
import { errorResponse } from '@/lib/api-error'
import { CopyBudgetsSchema } from '@/schemas/budget'
import { copyBudgets } from '@/services/budget-service'

// POST /api/budgets/copy — copy a month's budgets into another month for the
// manager's own department. Existing categories are skipped, not overwritten.
export async function POST(req: NextRequest) {
  const guard = await requireRole('manager')
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CopyBudgetsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: z.flattenError(parsed.error) },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await copyBudgets(guard.session, parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
