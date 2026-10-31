import { describe, expect, it } from 'vitest'
import { reviewScope } from '@/services/expense-scope'
import { budgetScope } from '@/services/budget-scope'
import type { Session } from '@/lib/auth'

const base: Session = {
  userId: 'user-1',
  organizationId: 'org-1',
  departmentId: 'dept-1',
  role: 'manager',
}

describe('reviewScope', () => {
  it('limits managers to staff expenses in their own department', () => {
    expect(reviewScope(base)).toEqual({
      departmentId: 'dept-1',
      submitterRole: 'staff',
      userId: { $ne: 'user-1' },
    })
  })

  it('lets a manager with no department review nothing', () => {
    expect(reviewScope({ ...base, departmentId: null })).toEqual({
      departmentId: { $in: [] },
      submitterRole: 'staff',
      userId: { $ne: 'user-1' },
    })
  })

  it('gives admins manager expenses only, so staff expenses stay read-only', () => {
    expect(reviewScope({ ...base, role: 'admin' })).toEqual({
      submitterRole: 'manager',
    })
  })

  it('never lets staff review, even if they reach the service', () => {
    expect(reviewScope({ ...base, role: 'staff' })).toBeNull()
  })
})

describe('budgetScope', () => {
  it('limits managers to their department', () => {
    expect(budgetScope(base)).toEqual({ departmentId: 'dept-1' })
  })

  it('gives admins the whole organization', () => {
    expect(budgetScope({ ...base, role: 'admin' })).toEqual({})
  })

  it('denies staff any budget access', () => {
    expect(budgetScope({ ...base, role: 'staff' })).toBeNull()
  })

  it('matches nothing for a manager without a department', () => {
    expect(budgetScope({ ...base, departmentId: null })).toEqual({
      departmentId: { $in: [] },
    })
  })
})
