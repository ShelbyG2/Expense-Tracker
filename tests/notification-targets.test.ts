import { describe, expect, it } from 'vitest'
import {
  audienceForBudgetThreshold,
  audienceForNewExpense,
  dedupeKeyForBudgetNotification,
} from '@/lib/notification-targets'

describe('notification targets', () => {
  it('routes a staff expense to that department’s managers', () => {
    expect(
      audienceForNewExpense({
        role: 'staff',
        departmentId: 'd1',
        organizationId: 'o1',
      }),
    ).toEqual({ organizationId: 'o1', departmentId: 'd1' })
  })

  it('routes a staff expense with no department to nobody', () => {
    // No manager can see it (reviewScope), so there is no audience.
    expect(
      audienceForNewExpense({
        role: 'staff',
        departmentId: null,
        organizationId: 'o1',
      }),
    ).toBeNull()
  })

  it('routes a manager expense to the organization admins', () => {
    expect(
      audienceForNewExpense({
        role: 'manager',
        departmentId: 'd1',
        organizationId: 'o1',
      }),
    ).toEqual({ organizationId: 'o1', departmentId: null })
  })

  it('routes an admin expense to the organization admins', () => {
    expect(
      audienceForNewExpense({
        role: 'admin',
        departmentId: 'd1',
        organizationId: 'o1',
      }),
    ).toEqual({ organizationId: 'o1', departmentId: null })
  })

  it('routes a budget threshold notice to the budget department', () => {
    expect(
      audienceForBudgetThreshold({
        budgetDepartmentId: 'd2',
        organizationId: 'o2',
      }),
    ).toEqual({ organizationId: 'o2', departmentId: 'd2' })
  })

  it('builds a stable dedupe key per budget and threshold', () => {
    expect(
      dedupeKeyForBudgetNotification('aaaaaaaaaaaaaaaaaaaaaaaa', 'warning'),
    ).toBe('budget:aaaaaaaaaaaaaaaaaaaaaaaa:warning')
    expect(
      dedupeKeyForBudgetNotification('aaaaaaaaaaaaaaaaaaaaaaaa', 'exceeded'),
    ).toBe('budget:aaaaaaaaaaaaaaaaaaaaaaaa:exceeded')
  })
})
