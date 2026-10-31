// Audit trail (business rule 7). Kept tiny so callers don't need to know the
// collection name; failures propagate so a mutation is never silently
// unaudited. Phase 7D adds the admin-only, read-only viewer query.

import mongoose from 'mongoose'
import type { FilterQuery } from 'mongoose'
import { connectDB } from '@/lib/db'
import { httpError } from '@/lib/api-error'
import type { Session } from '@/lib/auth'
import { AuditLog, type AuditAction, type IAuditLog } from '@/models/audit-log'
import { User } from '@/models/user'
import type { AuditQuery } from '@/schemas/audit'

const DAY_MS = 24 * 60 * 60 * 1000

export async function recordAudit(input: {
  organizationId: string
  userId: string
  action: AuditAction
  entity: string
  entityId: string
}): Promise<void> {
  await connectDB()
  await AuditLog.create({
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
  })
}

export type AuditLogView = {
  id: string
  userId: string
  userName: string | null
  action: AuditAction
  entity: string
  entityId: string
  createdAt: string
}

export type AuditListResult = {
  items: AuditLogView[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// Read-only audit viewer (Phase 7D). Admin only; scoped to the caller's
// organization like every other query (rule 1).
export async function listAuditLogs(
  session: Session,
  query: AuditQuery,
): Promise<AuditListResult> {
  if (session.role !== 'admin') throw httpError(403, 'Forbidden')

  await connectDB()

  const filter: FilterQuery<IAuditLog> = {
    organizationId: session.organizationId,
  }
  if (query.userId) filter.userId = query.userId
  if (query.entity) filter.entity = query.entity
  if (query.action) filter.action = query.action

  if (query.from || query.to) {
    const range: { $gte?: Date; $lte?: Date } = {}
    if (query.from) range.$gte = query.from
    // Inclusive end date: the whole `to` day.
    if (query.to) range.$lte = new Date(query.to.getTime() + DAY_MS - 1)
    filter.createdAt = range
  }

  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<IAuditLog[]>(),
  ])

  const userIds = [...new Set(docs.map((doc) => String(doc.userId)))].filter(
    (id) => mongoose.isValidObjectId(id),
  )
  const users =
    userIds.length > 0
      ? await User.find({
          organizationId: session.organizationId,
          _id: { $in: userIds },
        })
          .select('name')
          .lean<{ _id: unknown; name: string }[]>()
      : []
  const names = new Map(users.map((user) => [String(user._id), user.name]))

  return {
    items: docs.map((doc) => ({
      id: String(doc._id),
      userId: String(doc.userId),
      userName: names.get(String(doc.userId)) ?? null,
      action: doc.action,
      entity: doc.entity,
      entityId: String(doc.entityId),
      createdAt: doc.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  }
}
