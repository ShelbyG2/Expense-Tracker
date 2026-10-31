import mongoose from 'mongoose'
import type { Model } from 'mongoose'

// Destructure from the default export so these modules work both under
// Next.js (webpack/turbopack) and Node's native ESM loader (used by
// scripts/seed-dev-users.ts), which can't take named imports from CJS.
const { Schema, model, models } = mongoose

export const ROLES = ['admin', 'manager', 'staff'] as const
export type Role = (typeof ROLES)[number]

export interface IUser {
  _id: string
  organizationId: string
  // Nullable until departments are managed (Phase 5). The first admin
  // created during registration has no department yet.
  departmentId: string | null
  name: string
  email: string
  // Never returned by default (rule 8: passwords are never returned/logged).
  passwordHash: string
  role: Role
  isActive: boolean
  // True after an admin sets a temporary password: the user must change it
  // before they can use any other page or API (Phase 7A).
  mustChangePassword: boolean
  createdAt: Date
}

const UserSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  departmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
})

// Common lookups: by role within an org, and by email (login).
UserSchema.index({ organizationId: 1, role: 1 })

export const User: Model<IUser> =
  (models.User as Model<IUser>) || model<IUser>('User', UserSchema)
