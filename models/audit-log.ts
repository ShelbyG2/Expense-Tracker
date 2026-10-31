import mongoose from 'mongoose'
import type { Model } from 'mongoose'
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/constants'

const { Schema, model, models } = mongoose

// Rule 7: every create/update/delete/approve/reject writes an audit entry.
// The vocabulary is shared with the admin filter UI (Phase 7D).
export { AUDIT_ACTIONS, type AuditAction }

export interface IAuditLog {
  _id: string
  organizationId: string
  userId: string
  action: AuditAction
  entity: string
  entityId: string
  createdAt: Date
}

const AuditLogSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, enum: AUDIT_ACTIONS, required: true },
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
})

AuditLogSchema.index({ organizationId: 1, createdAt: -1 })
AuditLogSchema.index({ organizationId: 1, entity: 1, entityId: 1 })
AuditLogSchema.index({ organizationId: 1, userId: 1, createdAt: -1 })

export const AuditLog: Model<IAuditLog> =
  (models.AuditLog as Model<IAuditLog>) ||
  model<IAuditLog>('AuditLog', AuditLogSchema)
