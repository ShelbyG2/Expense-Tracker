import { z } from 'zod'
import { CATEGORIES } from '@/lib/constants'

// Shared between the budget forms and the server route handlers.
// Month is a calendar month (`YYYY-MM`); reports group on the same string.

export const BudgetMonthSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])$/,
    'Use a month in YYYY-MM format (for example 2026-10)',
  )

const fields = {
  category: z.enum(CATEGORIES, { error: 'Choose a valid category' }),
  amount: z.coerce
    .number({ error: 'Enter a valid amount' })
    .positive('Budget amount must be greater than 0')
    .finite(),
  month: BudgetMonthSchema,
  // Optional rollover of the previous month's unspent amount (Phase 7C).
  // Defaults to false in the service when omitted (pre-7C clients).
  carryOver: z
    .boolean({ error: 'Carry over must be true or false' })
    .optional(),
}

// `.strict()` so clients cannot inject departmentId, organizationId, etc.
export const CreateBudgetSchema = z.object(fields).strict()
export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>

export const UpdateBudgetSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>

export const BudgetListQuerySchema = z.object({
  month: BudgetMonthSchema.optional(),
  category: z.enum(CATEGORIES).optional(),
})
export type BudgetListQuery = z.infer<typeof BudgetListQuerySchema>

// Phase 7C: copy every budget from one month into another (own department).
export const CopyBudgetsSchema = z
  .object({
    fromMonth: BudgetMonthSchema,
    toMonth: BudgetMonthSchema,
  })
  .strict()
export type CopyBudgetsInput = z.infer<typeof CopyBudgetsSchema>
