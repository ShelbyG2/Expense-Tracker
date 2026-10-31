// Auth business logic: registration (org + first admin) and login.

import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import { hashPassword, verifyPassword } from '@/lib/password'
import { Organization } from '@/models/organization'
import { User, type Role } from '@/models/user'
import { recordAudit } from '@/services/audit-service'
import type { RegisterInput, ChangePasswordInput } from '@/schemas/auth'
import type { Session } from '@/lib/auth'

export type SafeUser = {
  id: string
  organizationId: string
  departmentId: string | null
  name: string
  email: string
  role: Role
  mustChangePassword: boolean
}

function toSafeUser(doc: {
  _id: unknown
  organizationId: unknown
  departmentId?: unknown
  name: string
  email: string
  role: Role
  mustChangePassword?: boolean
}): SafeUser {
  return {
    id: String(doc._id),
    organizationId: String(doc.organizationId),
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    mustChangePassword: doc.mustChangePassword ?? false,
  }
}

// Registration creates a new Organization and its first admin user.
// Throws Error with `.status` set by the caller for HTTP mapping.
export async function registerOrganizationAndAdmin(
  input: RegisterInput,
): Promise<{ user: SafeUser }> {
  await connectDB()

  const email = input.email.toLowerCase()

  const existing = await User.findOne({ email }).lean()
  if (existing) {
    throw Object.assign(new Error('Could not create account'), { status: 409 })
  }

  const passwordHash = await hashPassword(input.password)

  // Create the org first, then its first admin. If the admin create fails,
  // clean up the orphan org so we don't leave a half-registered tenant.
  const org = await Organization.create({ name: input.organizationName })

  try {
    const admin = await User.create({
      organizationId: org._id,
      departmentId: null,
      name: input.name,
      email,
      passwordHash,
      role: 'admin',
      isActive: true,
    })
    return { user: toSafeUser(admin) }
  } catch (err) {
    await Organization.deleteOne({ _id: org._id })
    throw err
  }
}

// Returns the authenticated user, or null if credentials are invalid/inactive.
// The caller must return a single generic error so we never reveal whether an
// email exists.
export async function authenticate(
  email: string,
  password: string,
): Promise<SafeUser | null> {
  await connectDB()

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    '+passwordHash',
  )

  if (!user || !user.isActive) return null

  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null

  return toSafeUser(user)
}

// The signed-in user changes their own password (Phase 7A). Requires the
// current password, clears the admin-set mustChangePassword flag and writes an
// audit entry. Hashes never leave this function.
export async function changeOwnPassword(
  session: Session,
  input: ChangePasswordInput,
): Promise<void> {
  await connectDB()

  const user = await User.findOne({
    _id: session.userId,
    organizationId: session.organizationId,
  }).select('+passwordHash')
  if (!user) throw httpError(401, 'Authentication required')

  const ok = await verifyPassword(input.currentPassword, user.passwordHash)
  if (!ok) throw httpError(400, 'Your current password is incorrect')

  user.passwordHash = await hashPassword(input.newPassword)
  user.mustChangePassword = false
  await user.save()

  await recordAudit({
    organizationId: session.organizationId,
    userId: session.userId,
    action: 'update',
    entity: 'User',
    entityId: String(user._id),
  })
}
