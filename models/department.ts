import mongoose from 'mongoose'
import type { Model } from 'mongoose'

const { Schema, model, models } = mongoose

export interface IDepartment {
  _id: string
  organizationId: string
  name: string
  // Phase 7D: archived departments keep their name in history but can no
  // longer receive new users, budgets or expenses.
  isArchived: boolean
  archivedAt: Date | null
  createdAt: Date
}

const DepartmentSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
})

// Department names are unique per organization. Archived departments keep
// their name reserved so old reports stay unambiguous.
DepartmentSchema.index({ organizationId: 1, name: 1 }, { unique: true })

export const Department: Model<IDepartment> =
  (models.Department as Model<IDepartment>) ||
  model<IDepartment>('Department', DepartmentSchema)
