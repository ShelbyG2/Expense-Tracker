// Admin business logic: users and departments for the whole organization.
// Routes require the admin role; every query is still org-scoped (rule 1),
// so an admin of one organization can never see or touch another's data.

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import { hashPassword, generateTemporaryPassword } from '@/lib/password'
import type { Session } from '@/lib/auth'
import { recordAudit } from '@/services/audit-service'
import { User, type IUser, type Role } from '@/models/user'
import { Department } from '@/models/department'
import { Budget } from '@/models/budget'
import { Expense } from '@/models/expense'
import type {
  CreateUserInput,
  DepartmentNameInput,
  ResetPasswordInput,
  UpdateUserInput,
} from '@/schemas/admin'

const DUPLICATE_KEY = 11000

export type AdminUserView = {
  id: string
  name: string
  email: string
  role: Role
  departmentId: string | null
  isActive: boolean
  createdAt: string
}

export type AdminDepartmentView = {
  id: string
  name: string
  userCount: number
  budgetCount: number
  expenseCount: number
  isArchived: boolean
  archivedAt: string | null
  createdAt: string
}

function toUserView(doc: IUser): AdminUserView {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === DUPLICATE_KEY
}

// Rejects a departmentId that doesn't belong to the caller's organization, so
// an admin can never attach users to another tenant's department. Archived
// departments cannot receive new users (Phase 7D).
async function assertOrgDepartment(
  session: Session,
  departmentId: string,
): Promise<void> {
  const department = await Department.findOne({
    _id: departmentId,
    organizationId: session.organizationId,
  })
    .select('isArchived')
    .lean<{ isArchived?: boolean } | null>()
  if (!department)
    throw httpError(400, 'The selected department does not exist')
  if (department.isArchived) {
    throw httpError(
      400,
      'That department is archived. Choose an active department.',
    )
  }
}

// ---------- Users ----------

export async function listUsers(session: Session): Promise<AdminUserView[]> {
  await connectDB()
  const docs = await User.find({ organizationId: session.organizationId })
    .sort({ name: 1 })
    .lean<IUser[]>()
  return docs.map(toUserView)
}

export async function createUser(
  session: Session,
  input: CreateUserInput,
): Promise<AdminUserView> {
  await connectDB()

  if (input.departmentId) {
    await assertOrgDepartment(session, input.departmentId)
  }

  const email = input.email.toLowerCase()
  const existing = await User.findOne({ email }).lean()
  if (existing) throw httpError(409, 'That email address is already in use')

  const passwordHash = await hashPassword(input.password)

  try {
    const user = await User.create({
      organizationId: session.organizationId,
      departmentId: input.departmentId,
      name: input.name,
      email,
      passwordHash,
      role: input.role,
      isActive: true,
    })
    await recordAudit({
      organizationId: session.organizationId,
      userId: session.userId,
      action: 'create',
      entity: 'User',
      entityId: String(user._id),
    })
    return toUserView(user)
  } catch (err) {
    // Unique email index catches the concurrent-create race.
    if (isDuplicateKey(err))
      throw httpError(409, 'That email address is already in use')
    throw err
  }
}

export async function updateUser(
  session: Session,
  id: string,
  input: UpdateUserInput,
): Promise<AdminUserView> {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'User not found')

  await connectDB()

  const user = await User.findOne({
    _id: id,
    organizationId: session.organizationId,
  })
  if (!user) throw httpError(404, 'User not found')

  // An admin may neither demote nor deactivate themselves (lockout guard),
  // and the org must always keep one active admin.
  const touchesStatus = input.role !== undefined || input.isActive !== undefined
  if (touchesStatus && String(user._id) === session.userId) {
    throw httpError(400, 'You cannot change your own role or status')
  }

  const losesAdmin =
    (input.role !== undefined && input.role !== 'admin') ||
    input.isActive === false
  if (losesAdmin && user.role === 'admin' && user.isActive) {
    const otherAdmins = await User.countDocuments({
      organizationId: session.organizationId,
      role: 'admin',
      isActive: true,
      _id: { $ne: user._id },
    })
    if (otherAdmins === 0) {
      throw httpError(
        400,
        'Your organization must keep at least one active admin',
      )
    }
  }

  if (input.email !== undefined) {
    const email = input.email.toLowerCase()
    const clash = await User.findOne({
      email,
      _id: { $ne: user._id },
    }).lean()
    if (clash) throw httpError(409, 'That email address is already in use')
    user.email = email
  }

  if (input.departmentId !== undefined) {
    // Only a *change* needs an active department: users already in an archived
    // department may still have their role or name edited.
    const changed =
      String(input.departmentId ?? '') !== String(user.departmentId ?? '')
    if (input.departmentId && changed) {
      await assertOrgDepartment(session, input.departmentId)
    }
    user.departmentId = input.departmentId
  }

  if (input.name !== undefined) user.name = input.name
  if (input.role !== undefined) user.role = input.role
  if (input.isActive !== undefined) user.isActive = input.isActive

  try {
    await user.save()
  } catch (err) {
    if (isDuplicateKey(err))
      throw httpError(409, 'That email address is already in use')
    throw err
  }

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'User',
    entityId: String(user._id),
  })
  return toUserView(user)
}

// Admin sets a temporary password (Phase 7A). The plaintext temporary
// password is returned exactly once, to the admin who requested it; only the
// hash is stored. mustChangePassword blocks the user's next session until they
// pick their own password. An admin cannot reset their own password here —
// that would sidestep the current-password check on /account.
export async function resetUserPassword(
  session: Session,
  id: string,
  input: ResetPasswordInput,
): Promise<{ temporaryPassword: string }> {
  if (!mongoose.isValidObjectId(id)) throw httpError(404, 'User not found')

  await connectDB()

  const user = await User.findOne({
    _id: id,
    organizationId: session.organizationId,
  })
  if (!user) throw httpError(404, 'User not found')
  if (String(user._id) === session.userId) {
    throw httpError(400, 'You cannot reset your own password')
  }

  const temporaryPassword = input.password ?? generateTemporaryPassword()
  user.passwordHash = await hashPassword(temporaryPassword)
  user.mustChangePassword = true
  await user.save()

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'User',
    entityId: String(user._id),
  })

  return { temporaryPassword }
}

// ---------- Departments ----------

type DepartmentCounts = {
  userCount: number
  budgetCount: number
  expenseCount: number
}

type DepartmentDoc = {
  _id: unknown
  name: string
  isArchived?: boolean
  archivedAt?: Date | null
  createdAt: Date
}

function toDepartmentView(
  doc: DepartmentDoc,
  counts: DepartmentCounts,
): AdminDepartmentView {
  return {
    id: String(doc._id),
    name: doc.name,
    userCount: counts.userCount,
    budgetCount: counts.budgetCount,
    expenseCount: counts.expenseCount,
    isArchived: doc.isArchived ?? false,
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  }
}

async function referenceCounts(
  session: Session,
  departmentId: unknown,
): Promise<DepartmentCounts> {
  const filter = {
    organizationId: session.organizationId,
    departmentId,
  }
  const [userCount, budgetCount, expenseCount] = await Promise.all([
    User.countDocuments(filter),
    Budget.countDocuments(filter),
    Expense.countDocuments(filter),
  ])
  return { userCount, budgetCount, expenseCount }
}

// Counts per department in one round trip each; lets the admin table explain
// why a hard delete is refused without an extra request per row.
async function countByDepartment(
  session: Session,
  collection: 'users' | 'budgets' | 'expenses',
): Promise<Map<string, number>> {
  const group = (rows: { _id: unknown; count: number }[]) =>
    new Map(rows.map((row) => [String(row._id), row.count] as const))

  const match = {
    organizationId: new mongoose.Types.ObjectId(session.organizationId),
  }
  const pipeline = [
    { $match: match },
    { $group: { _id: '$departmentId', count: { $sum: 1 } } },
  ]

  if (collection === 'users') {
    return group(
      await User.aggregate<{ _id: unknown; count: number }>(pipeline),
    )
  }
  if (collection === 'budgets') {
    return group(
      await Budget.aggregate<{ _id: unknown; count: number }>(pipeline),
    )
  }
  return group(
    await Expense.aggregate<{ _id: unknown; count: number }>(pipeline),
  )
}

export async function listDepartments(
  session: Session,
): Promise<AdminDepartmentView[]> {
  await connectDB()

  const [docs, userCounts, budgetCounts, expenseCounts] = await Promise.all([
    Department.find({ organizationId: session.organizationId })
      .sort({ name: 1 })
      .lean<DepartmentDoc[]>(),
    countByDepartment(session, 'users'),
    countByDepartment(session, 'budgets'),
    countByDepartment(session, 'expenses'),
  ])

  return docs.map((doc) => {
    const id = String(doc._id)
    return toDepartmentView(doc, {
      userCount: userCounts.get(id) ?? 0,
      budgetCount: budgetCounts.get(id) ?? 0,
      expenseCount: expenseCounts.get(id) ?? 0,
    })
  })
}

export async function createDepartment(
  session: Session,
  input: DepartmentNameInput,
): Promise<AdminDepartmentView> {
  await connectDB()

  const existing = await Department.findOne({
    organizationId: session.organizationId,
    name: input.name,
  }).lean()
  if (existing)
    throw httpError(409, 'A department with that name already exists')

  try {
    const department = await Department.create({
      organizationId: session.organizationId,
      name: input.name,
    })
    await recordAudit({
      organizationId: session.organizationId,
      userId: session.userId,
      action: 'create',
      entity: 'Department',
      entityId: String(department._id),
    })
    return toDepartmentView(department, {
      userCount: 0,
      budgetCount: 0,
      expenseCount: 0,
    })
  } catch (err) {
    // Unique (organizationId, name) index catches the concurrent-create race.
    if (isDuplicateKey(err)) {
      throw httpError(409, 'A department with that name already exists')
    }
    throw err
  }
}

export async function updateDepartment(
  session: Session,
  id: string,
  input: DepartmentNameInput,
): Promise<AdminDepartmentView> {
  if (!mongoose.isValidObjectId(id))
    throw httpError(404, 'Department not found')

  await connectDB()

  const department = await Department.findOne({
    _id: id,
    organizationId: session.organizationId,
  })
  if (!department) throw httpError(404, 'Department not found')

  const clash = await Department.findOne({
    organizationId: session.organizationId,
    name: input.name,
    _id: { $ne: department._id },
  }).lean()
  if (clash) throw httpError(409, 'A department with that name already exists')

  department.name = input.name
  try {
    await department.save()
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw httpError(409, 'A department with that name already exists')
    }
    throw err
  }

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'Department',
    entityId: String(department._id),
  })

  return toDepartmentView(
    department,
    await referenceCounts(session, department._id),
  )
}

// Archiving keeps the department (and its name in old reports) but stops new
// users, budgets and expenses from being assigned to it (Phase 7D).
export async function archiveDepartment(
  session: Session,
  id: string,
): Promise<AdminDepartmentView> {
  if (!mongoose.isValidObjectId(id))
    throw httpError(404, 'Department not found')

  await connectDB()

  const department = await Department.findOne({
    _id: id,
    organizationId: session.organizationId,
  })
  if (!department) throw httpError(404, 'Department not found')
  if (department.isArchived) {
    throw httpError(409, 'That department is already archived')
  }

  department.isArchived = true
  department.archivedAt = new Date()
  await department.save()

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'Department',
    entityId: String(department._id),
  })

  return toDepartmentView(
    department,
    await referenceCounts(session, department._id),
  )
}

export async function unarchiveDepartment(
  session: Session,
  id: string,
): Promise<AdminDepartmentView> {
  if (!mongoose.isValidObjectId(id))
    throw httpError(404, 'Department not found')

  await connectDB()

  const department = await Department.findOne({
    _id: id,
    organizationId: session.organizationId,
  })
  if (!department) throw httpError(404, 'Department not found')
  if (!department.isArchived) {
    throw httpError(409, 'That department is not archived')
  }

  department.isArchived = false
  department.archivedAt = null
  await department.save()

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'Department',
    entityId: String(department._id),
  })

  return toDepartmentView(
    department,
    await referenceCounts(session, department._id),
  )
}

// Hard delete is only allowed when nothing at all references the department,
// including expenses (Phase 7D). Archive is the normal way to retire one.
export async function deleteDepartment(
  session: Session,
  id: string,
): Promise<void> {
  if (!mongoose.isValidObjectId(id))
    throw httpError(404, 'Department not found')

  await connectDB()

  const department = await Department.findOne({
    _id: id,
    organizationId: session.organizationId,
  }).lean()
  if (!department) throw httpError(404, 'Department not found')

  const users = await User.countDocuments({
    organizationId: session.organizationId,
    departmentId: department._id,
  })
  if (users > 0) {
    throw httpError(
      409,
      users === 1
        ? '1 user is still assigned to this department. Reassign them first.'
        : `${users} users are still assigned to this department. Reassign them first.`,
    )
  }

  const budgets = await Budget.countDocuments({
    organizationId: session.organizationId,
    departmentId: department._id,
  })
  if (budgets > 0) {
    throw httpError(
      409,
      budgets === 1
        ? '1 budget still belongs to this department. Delete it first.'
        : `${budgets} budgets still belong to this department. Delete them first.`,
    )
  }

  const expenses = await Expense.countDocuments({
    organizationId: session.organizationId,
    departmentId: department._id,
  })
  if (expenses > 0) {
    throw httpError(
      409,
      expenses === 1
        ? '1 expense still references this department. Archive it instead.'
        : `${expenses} expenses still reference this department. Archive it instead.`,
    )
  }

  await Department.deleteOne({ _id: department._id })
  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'delete',
    entity: 'Department',
    entityId: String(department._id),
  })
}
