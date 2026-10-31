// Budget business logic. Managers manage their own department's budgets;
// admins can read the whole organization but never create or change them.

import mongoose from 'mongoose'
import type { FilterQuery } from 'mongoose'
import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import type { Session } from '@/lib/auth'
import { budgetScope } from '@/services/budget-scope'
import { recordAudit } from '@/services/audit-service'
import { Budget, type IBudget } from '@/models/budget'
import { Department } from '@/models/department'
import type {
  BudgetListQuery,
  CopyBudgetsInput,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '@/schemas/budget'

export type BudgetView = {
  id: string
  organizationId: string
  departmentId: string
  category: IBudget['category']
  amount: number
  month: string
  carryOver: boolean
  createdAt: string
}

export type CopyBudgetsResult = {
  month: string
  created: number
  skipped: number
}

export type BudgetListResult = {
  items: BudgetView[]
  total: number
}

const DUPLICATE_KEY = 11000

function toView(doc: IBudget): BudgetView {
  return {
    id: String(doc._id),
    organizationId: String(doc.organizationId),
    departmentId: String(doc.departmentId),
    category: doc.category,
    amount: doc.amount,
    month: doc.month,
    // Documents created before Phase 7C have no flag.
    carryOver: doc.carryOver ?? false,
    createdAt: doc.createdAt.toISOString(),
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === DUPLICATE_KEY
}

// Archived departments keep their existing budgets read-only (Phase 7D): no
// new budgets and no copies into them.
async function assertActiveDepartment(session: Session): Promise<void> {
  const department = await Department.findOne({
    _id: session.departmentId,
    organizationId: session.organizationId,
  })
    .select('isArchived')
    .lean<{ isArchived?: boolean } | null>()
  if (department?.isArchived) {
    throw httpError(
      400,
      'Your department is archived, so new budgets cannot be added.',
    )
  }
}

export async function listBudgets(
  session: Session,
  query: BudgetListQuery,
): Promise<BudgetListResult> {
  const scope = budgetScope(session)
  if (!scope) throw httpError(403, 'Forbidden')

  await connectDB()

  const filter: FilterQuery<IBudget> = {
    organizationId: session.organizationId,
    ...scope,
  }
  if (query.month) filter.month = query.month
  if (query.category) filter.category = query.category

  const docs = await Budget.find(filter)
    .sort({ month: -1, category: 1 })
    .lean<IBudget[]>()

  return { items: docs.map(toView), total: docs.length }
}

// Returns null when the budget is outside the caller's scope, so routes can
// answer 404 without revealing that another department's budget exists.
export async function getBudget(
  session: Session,
  id: string,
): Promise<BudgetView | null> {
  const scope = budgetScope(session)
  if (!scope) throw httpError(403, 'Forbidden')

  await connectDB()

  if (!mongoose.isValidObjectId(id)) return null

  const doc = await Budget.findOne({
    _id: id,
    organizationId: session.organizationId,
    ...scope,
  }).lean<IBudget | null>()

  return doc ? toView(doc) : null
}

export async function createBudget(
  session: Session,
  input: CreateBudgetInput,
): Promise<BudgetView> {
  // Defense in depth: the route already requires the manager role, and admins
  // are read-only here.
  if (session.role !== 'manager') throw httpError(403, 'Forbidden')
  if (!session.departmentId) {
    throw httpError(
      400,
      'Assign a department to your account before setting budgets',
    )
  }

  await connectDB()
  await assertActiveDepartment(session)

  const duplicate = await Budget.findOne({
    organizationId: session.organizationId,
    departmentId: session.departmentId,
    category: input.category,
    month: input.month,
  }).lean()
  if (duplicate) {
    throw httpError(409, 'A budget for this category and month already exists')
  }

  let doc: IBudget
  try {
    doc = await Budget.create({
      organizationId: session.organizationId,
      departmentId: session.departmentId,
      category: input.category,
      amount: input.amount,
      month: input.month,
      carryOver: input.carryOver ?? false,
    })
  } catch (err) {
    // Two concurrent creates: the unique index catches the loser.
    if (isDuplicateKey(err)) {
      throw httpError(
        409,
        'A budget for this category and month already exists',
      )
    }
    throw err
  }

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'create',
    entity: 'Budget',
    entityId: String(doc._id),
  })

  return toView(doc)
}

export async function updateBudget(
  session: Session,
  id: string,
  input: UpdateBudgetInput,
): Promise<BudgetView> {
  if (session.role !== 'manager') throw httpError(403, 'Forbidden')

  await connectDB()

  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Budget not found')

  const doc = await Budget.findOne({
    _id: id,
    organizationId: session.organizationId,
    ...(budgetScope(session) ?? {}),
  })
  if (!doc) throw httpError(404, 'Budget not found')

  const category = input.category ?? doc.category
  const month = input.month ?? doc.month

  if (category !== doc.category || month !== doc.month) {
    const clash = await Budget.findOne({
      organizationId: session.organizationId,
      departmentId: doc.departmentId,
      category,
      month,
      _id: { $ne: doc._id },
    }).lean()
    if (clash) {
      throw httpError(
        409,
        'A budget for this category and month already exists',
      )
    }
  }

  if (input.category !== undefined) doc.category = input.category
  if (input.amount !== undefined) doc.amount = input.amount
  if (input.month !== undefined) doc.month = input.month
  if (input.carryOver !== undefined) doc.carryOver = input.carryOver

  try {
    await doc.save()
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw httpError(
        409,
        'A budget for this category and month already exists',
      )
    }
    throw err
  }

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'Budget',
    entityId: String(doc._id),
  })

  return toView(doc)
}

// Copy every budget of a source month into a target month (Phase 7C), skipping
// categories that already have a budget there. Audits each created budget
// (rule 7) and reports how many were created and skipped.
export async function copyBudgets(
  session: Session,
  input: CopyBudgetsInput,
): Promise<CopyBudgetsResult> {
  if (session.role !== 'manager') throw httpError(403, 'Forbidden')
  if (!session.departmentId) {
    throw httpError(
      400,
      'Assign a department to your account before copying budgets',
    )
  }

  await connectDB()
  await assertActiveDepartment(session)

  const [source, existing] = await Promise.all([
    Budget.find({
      organizationId: session.organizationId,
      departmentId: session.departmentId,
      month: input.fromMonth,
    }).lean<IBudget[]>(),
    Budget.find({
      organizationId: session.organizationId,
      departmentId: session.departmentId,
      month: input.toMonth,
    })
      .select('category')
      .lean<{ category: IBudget['category'] }[]>(),
  ])

  const taken = new Set(existing.map((budget) => budget.category))
  let created = 0
  let skipped = 0

  for (const budget of source) {
    if (taken.has(budget.category)) {
      skipped++
      continue
    }

    let doc: IBudget
    try {
      doc = await Budget.create({
        organizationId: session.organizationId,
        departmentId: session.departmentId,
        category: budget.category,
        amount: budget.amount,
        month: input.toMonth,
        // The rollover flag is per month; a copy starts opted out.
        carryOver: false,
      })
    } catch (err) {
      if (isDuplicateKey(err)) {
        skipped++
        continue
      }
      throw err
    }

    await recordAudit({
      organizationId: session.organizationId,
      userId: session.userId,
      action: 'create',
      entity: 'Budget',
      entityId: String(doc._id),
    })
    taken.add(budget.category)
    created++
  }

  return { month: input.toMonth, created, skipped }
}

export async function deleteBudget(
  session: Session,
  id: string,
): Promise<void> {
  if (session.role !== 'manager') throw httpError(403, 'Forbidden')

  await connectDB()

  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Budget not found')

  const doc = await Budget.findOne({
    _id: id,
    organizationId: session.organizationId,
    ...(budgetScope(session) ?? {}),
  })
  if (!doc) throw httpError(404, 'Budget not found')

  await doc.deleteOne()

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'delete',
    entity: 'Budget',
    entityId: String(doc._id),
  })
}
