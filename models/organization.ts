import mongoose from 'mongoose'
import type { Model } from 'mongoose'
import { DEFAULT_CURRENCY } from '@/lib/constants'

// Destructure from the default export so these modules work both under
// Next.js (webpack/turbopack) and Node's native ESM loader (used by
// scripts/seed-dev-users.ts), which can't take named imports from CJS.
const { Schema, model, models } = mongoose

export interface IOrganization {
  _id: string
  name: string
  // Ratio (0.8 = 80%) at which a budget turns into a warning (Phase 7C).
  // Above 100% is always exceeded, so only the warning line is configurable.
  warningThreshold: number
  // ISO 4217 code used when formatting amounts (Phase 7D). Display only —
  // amounts are never converted.
  currency: string
  createdAt: Date
}

const OrganizationSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true,
    maxlength: 100,
  },
  warningThreshold: {
    type: Number,
    default: 0.8,
    min: 0.5,
    max: 0.95,
  },
  currency: {
    type: String,
    default: DEFAULT_CURRENCY,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{3}$/, 'Use a three-letter ISO currency code'],
  },
  createdAt: { type: Date, default: Date.now },
})

export const Organization: Model<IOrganization> =
  (models.Organization as Model<IOrganization>) ||
  model<IOrganization>('Organization', OrganizationSchema)
