import { z } from 'zod'
import { BudgetMonthSchema } from '@/schemas/budget'

// Shared between the /reports page filter and the CSV export route.
// `month` is the same `YYYY-MM` string budgets use, so reports and budgets
// always line up.

export const ReportQuerySchema = z.object({
  month: BudgetMonthSchema.optional(),
})
export type ReportQuery = z.infer<typeof ReportQuerySchema>

export const ReportExportQuerySchema = z
  .object({
    report: z.enum(['summary', 'budget'], {
      error: 'Choose summary or budget',
    }),
    // CSV by default; XLSX added in Phase 7C.
    format: z.enum(['csv', 'xlsx']).default('csv'),
    month: BudgetMonthSchema.optional(),
  })
  .strict()
export type ReportExportQuery = z.infer<typeof ReportExportQuerySchema>
