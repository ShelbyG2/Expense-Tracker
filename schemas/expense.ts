import { z } from 'zod'
import { CATEGORIES, EXPENSE_STATUSES } from '@/lib/constants'

// Shared between the client forms and the server route handlers (rule 3).

// Parse a `YYYY-MM-DD` string into a UTC-midnight Date, rejecting impossible
// calendar dates (e.g. 2026-02-31) that `new Date()` would silently roll over.
export function parseDateOnly(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  return valid ? date : null
}

// A future date is anything after the end of today (UTC). Using end-of-day
// keeps "today" valid for users whose local date is ahead of UTC.
function endOfTodayUtc(): number {
  const now = new Date()
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23,
    59,
    59,
    999,
  )
}

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
  .refine((value) => parseDateOnly(value) !== null, 'Enter a valid date')
  .transform((value) => parseDateOnly(value) as Date)

// Expense dates may not be in the future; filter bounds may be.
const pastDate = dateOnly.refine(
  (date) => date.getTime() <= endOfTodayUtc(),
  'Date cannot be in the future',
)

const fields = {
  category: z.enum(CATEGORIES, { error: 'Choose a valid category' }),
  amount: z.coerce
    .number({ error: 'Enter a valid amount' })
    .positive('Amount must be greater than 0')
    .finite(),
  date: pastDate,
  description: z
    .string()
    .trim()
    .max(200, 'Description must be 200 characters or fewer')
    .optional(),
}

// `.strict()` so clients cannot inject status, userId, organizationId, etc.
export const CreateExpenseSchema = z.object(fields).strict()
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>

export const UpdateExpenseSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>

// Managers/admins review a pending expense. The reason is optional and stored
// on the expense so staff can see why something was rejected.
export const ReviewExpenseSchema = z
  .object({
    action: z.enum(['approve', 'reject'], {
      error: 'Choose approve or reject',
    }),
    reason: z
      .string()
      .trim()
      .max(200, 'Reason must be 200 characters or fewer')
      .optional(),
  })
  .strict()
export type ReviewExpenseInput = z.infer<typeof ReviewExpenseSchema>

export const ExpenseListQuerySchema = z
  .object({
    category: z.enum(CATEGORIES).optional(),
    status: z.enum(EXPENSE_STATUSES).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(['date', 'amount', 'createdAt']).default('date'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from.getTime() <= q.to.getTime(), {
    message: 'The "from" date must be on or before the "to" date',
  })
export type ExpenseListQuery = z.infer<typeof ExpenseListQuerySchema>
