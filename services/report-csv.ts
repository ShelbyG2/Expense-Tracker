// CSV serialization for the Phase 4/7C report exports (pure functions, so they
// can be unit-tested without a database — report-service itself needs one).
// Headers name the organization's currency (Phase 7D); amounts are never
// converted.

import { toCsv } from '@/lib/csv'
import type {
  BudgetVsActualRow,
  SummaryReport,
} from '@/services/report-service'

export function summaryToCsv(report: SummaryReport, currency: string): string {
  const amount = ` (${currency})`
  const rows: (string | number)[][] = [
    ['Expense summary', report.month],
    [`Total approved${amount}`, report.totalApproved],
    [`Awaiting approval${amount}`, report.awaitingApproval],
    [],
    ['Category', `Approved${amount}`],
    ...report.byCategory.map((row) => [row.category, row.total]),
    [],
    ['Department', `Approved${amount}`],
    ...report.byDepartment.map((row) => [row.name, row.total]),
  ]
  return toCsv(rows)
}

export function budgetHeader(currency: string): string[] {
  const amount = ` (${currency})`
  return [
    'Department',
    'Category',
    `Budget${amount}`,
    `Carried over${amount}`,
    `Available${amount}`,
    `Spent${amount}`,
    `Remaining${amount}`,
    'Percent used',
    'Status',
    `Awaiting approval${amount}`,
  ]
}

// Unbudgeted rows have no budget, available amount, remaining or percentage, so
// those cells stay empty instead of showing a misleading zero.
export function budgetToCsv(
  rows: BudgetVsActualRow[],
  currency: string,
): string {
  return toCsv([
    budgetHeader(currency),
    ...rows.map((row) => [
      row.departmentName,
      row.category,
      row.budget ?? '',
      row.carriedOver,
      row.available ?? '',
      row.spent,
      row.remaining ?? '',
      // Percent with one decimal (87.5 = 87.5% used).
      row.percentUsed === null ? '' : Math.round(row.percentUsed * 1000) / 10,
      row.status,
      row.awaitingApproval,
    ]),
  ])
}
