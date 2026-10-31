import mongoose from 'mongoose'
import type { Model } from 'mongoose'
import {
  NOTIFICATION_TTL_DAYS,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '@/lib/constants'

const { Schema, model, models } = mongoose

// Phase 7E: in-app notifications. One document per recipient, so a query can
// never leak another user's messages (rule 1: always scope by organization and
// user). The vocabulary lives in lib/constants.ts so client components can use
// it without importing mongoose.
export { NOTIFICATION_TYPES, type NotificationType }

export interface INotification {
  _id: string
  organizationId: string
  userId: string
  type: NotificationType
  message: string
  link: string
  readAt: Date | null
  dedupeKey?: string | null
  createdAt: Date
}

const NotificationSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  message: { type: String, required: true, maxlength: 300 },
  link: { type: String, required: true, maxlength: 300 },
  readAt: { type: Date, default: null },
  dedupeKey: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
})

NotificationSchema.index({
  organizationId: 1,
  userId: 1,
  readAt: 1,
  createdAt: -1,
})

NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_TTL_DAYS * 24 * 60 * 60 },
)

NotificationSchema.index(
  { organizationId: 1, userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
)

export const Notification: Model<INotification> =
  (models.Notification as Model<INotification>) ||
  model<INotification>('Notification', NotificationSchema)
