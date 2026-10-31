import mongoose from 'mongoose'
import type { Model } from 'mongoose'
import { CATEGORIES, EXPENSE_STATUSES } from '@/lib/constants'

// Destructure from the default export so this module also loads under Node's
// native ESM loader (used by scripts/), which can't take named CJS imports.
const { Schema, model, models } = mongoose

// Who submitted the expense (Phase 7B). Managers may record their own
// expenses too; their department's manager reviews staff expenses, and an
// admin reviews manager expenses, so nobody approves their own spending.
export const SUBMITTER_ROLES = ['staff', 'manager'] as const
export type SubmitterRole = (typeof SUBMITTER_ROLES)[number]

export interface IExpense {
  _id: string
  organizationId: string
  // Derived from the author's user record, never from the request body.
  departmentId: string | null
  userId: string
  // Taken from the session at creation (never from the client). Documents
  // created before Phase 7B default to 'staff'.
  submitterRole: SubmitterRole
  category: (typeof CATEGORIES)[number]
  amount: number
  date: Date
  description: string
  status: (typeof EXPENSE_STATUSES)[number]
  reviewedBy: string | null
  reviewedAt: Date | null
  // Optional note from the manager who approved/rejected the expense.
  reviewNote: string | null
  createdAt: Date
}

const ExpenseSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  departmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  submitterRole: {
    type: String,
    enum: SUBMITTER_ROLES,
    default: 'staff',
    required: true,
  },
  category: { type: String, enum: CATEGORIES, required: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, required: true },
  description: { type: String, default: '', trim: true, maxlength: 200 },
  status: {
    type: String,
    enum: EXPENSE_STATUSES,
    default: 'pending',
    required: true,
  },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: null, trim: true, maxlength: 200 },
  createdAt: { type: Date, default: Date.now },
})

// Department and personal listings, both newest-first (master prompt examples).
ExpenseSchema.index({ organizationId: 1, departmentId: 1, date: -1 })
ExpenseSchema.index({ organizationId: 1, userId: 1, date: -1 })
// Status filtering for approvals (Phase 3) and list filters.
ExpenseSchema.index({ organizationId: 1, status: 1, date: -1 })
// The review queue is pending + submitterRole (+ department) (Phase 7B).
ExpenseSchema.index({ organizationId: 1, status: 1, submitterRole: 1 })

export const Expense: Model<IExpense> =
  (models.Expense as Model<IExpense>) ||
  model<IExpense>('Expense', ExpenseSchema)
