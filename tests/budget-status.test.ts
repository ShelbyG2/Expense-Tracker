import { describe, expect, it } from 'vitest'
import {
  BUDGET_THRESHOLDS,
  WARNING_THRESHOLD_MAX,
  WARNING_THRESHOLD_MIN,
  budgetStatus,
  percentUsed,
} from '@/lib/budget-status'

describe('percentUsed', () => {
  it('is spent divided by budget', () => {
    expect(percentUsed(750, 1000)).toBe(0.75)
    expect(percentUsed(400, 500)).toBe(0.8)
  })

  it('never produces Infinity for a zero budget', () => {
    expect(percentUsed(100, 0)).toBe(0)
  })
})

// Business rule 6: below 80% = ok, 80% to 100% = warning, above 100% =
// exceeded. Thresholds live in one config constant.
describe('budgetStatus', () => {
  it('keeps both thresholds in a single config constant', () => {
    expect(BUDGET_THRESHOLDS).toEqual({ warning: 0.8, exceeded: 1 })
  })

  it('is ok below 80%', () => {
    expect(budgetStatus(0)).toBe('ok')
    expect(budgetStatus(0.5)).toBe('ok')
    expect(budgetStatus(0.7999)).toBe('ok')
  })

  it('is a warning from 80% through exactly 100%', () => {
    expect(budgetStatus(0.8)).toBe('warning')
    expect(budgetStatus(0.9)).toBe('warning')
    expect(budgetStatus(1)).toBe('warning')
  })

  it('is exceeded above 100%', () => {
    expect(budgetStatus(1.0001)).toBe('exceeded')
    expect(budgetStatus(1.25)).toBe('exceeded')
  })

  it('takes a per-organization warning threshold (Phase 7C)', () => {
    const thresholds = { warning: 0.6, exceeded: 1 }
    expect(budgetStatus(0.59, thresholds)).toBe('ok')
    expect(budgetStatus(0.6, thresholds)).toBe('warning')
    expect(budgetStatus(0.8, thresholds)).toBe('warning')
    expect(budgetStatus(1.01, thresholds)).toBe('exceeded')
    // The default is unchanged when no thresholds are passed.
    expect(budgetStatus(0.6)).toBe('ok')
  })

  it('limits the configurable warning line to 50–95%', () => {
    expect(WARNING_THRESHOLD_MIN).toBe(0.5)
    expect(WARNING_THRESHOLD_MAX).toBe(0.95)
  })
})
