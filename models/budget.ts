import mongoose from 'mongoose'
import type { Model } from 'mongoose'
import { CATEGORIES } from '@/lib/constants'

const { Schema, model, models } = mongoose

export interface IBudget {
  _id: string
  organizationId: string
  // Budgets belong to a department; managers only manage their own.
  departmentId: string
  category: (typeof CATEGORIES)[number]
  amount: number
  // Calendar month in `YYYY-MM` form.
  month: string
  // Add the previous month's unspent approved amount to this month's available
  // budget (Phase 7C). Default false, so nothing changes unless opted in.
  carryOver: boolean
  createdAt: Date
}

const BudgetSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  departmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
  },
  category: { type: String, enum: CATEGORIES, required: true },
  amount: { type: Number, required: true, min: 0 },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  carryOver: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
})

// One budget per department, category and month; also the report lookup.
BudgetSchema.index(
  { organizationId: 1, departmentId: 1, category: 1, month: 1 },
  { unique: true },
)
BudgetSchema.index({ organizationId: 1, departmentId: 1, month: 1 })

export const Budget: Model<IBudget> =
  (models.Budget as Model<IBudget>) || model<IBudget>('Budget', BudgetSchema)
