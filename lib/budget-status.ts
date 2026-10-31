// Budget status thresholds (business rule 6). The defaults live in ONE config
// constant; organizations may override the warning threshold (Phase 7C), so
// every caller passes a threshold object instead of reading the constant.
// Imported by server reports and client rendering, so keep it dependency-free.

export const BUDGET_THRESHOLDS = {
  // percentUsed at or above this ratio is a warning.
  warning: 0.8,
  // percentUsed above this ratio is exceeded (exactly 100% stays a warning).
  exceeded: 1,
} as const

export type BudgetThresholds = {
  warning: number
  exceeded: number
}

// Organization warning thresholds are limited to this range (Phase 7C).
export const WARNING_THRESHOLD_MIN = 0.5
export const WARNING_THRESHOLD_MAX = 0.95

export type BudgetStatus = 'ok' | 'warning' | 'exceeded' | 'unbudgeted'
// `budgetStatus` derives a status from a ratio, so it never returns
// 'unbudgeted' — that comes from the data (no budget exists), not the math.
export type RatioStatus = Exclude<BudgetStatus, 'unbudgeted'>

// spent / budget as a ratio (0.85 = 85% used). Budgets are > 0 by schema;
// the guard keeps a zero budget from producing Infinity.
export function percentUsed(spent: number, budget: number): number {
  return budget > 0 ? spent / budget : 0
}

export function budgetStatus(
  ratio: number,
  thresholds: BudgetThresholds = BUDGET_THRESHOLDS,
): RatioStatus {
  if (ratio > thresholds.exceeded) return 'exceeded'
  if (ratio >= thresholds.warning) return 'warning'
  return 'ok'
}
