import { describe, expect, it } from 'vitest'
import { budgetScope } from '@/services/budget-scope'
import type { Session } from '@/lib/auth'

const base: Session = {
  userId: 'user-1',
  organizationId: 'org-1',
  departmentId: 'dept-1',
  role: 'staff',
}

// Business rule: budgets are managed by managers (own department), read by
// admins (whole organization) and closed to staff entirely.
describe('budgetScope', () => {
  it('allows staff no access at all (callers answer 403, not an empty list)', () => {
    expect(budgetScope(base)).toBeNull()
  })

  it('limits managers to their own department', () => {
    expect(budgetScope({ ...base, role: 'manager' })).toEqual({
      departmentId: 'dept-1',
    })
  })

  it('matches nothing for a manager with no department', () => {
    const scope = budgetScope({ ...base, role: 'manager', departmentId: null })
    // Must not mean "every budget whose departmentId is null".
    expect(scope).not.toEqual({ departmentId: null })
    expect(scope?.departmentId).toEqual({ $in: [] })
  })

  it('gives admins the whole organization (org filter is applied by the service)', () => {
    expect(budgetScope({ ...base, role: 'admin' })).toEqual({})
  })
})
