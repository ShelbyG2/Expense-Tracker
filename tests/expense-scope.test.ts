import { describe, expect, it } from 'vitest'
import { expenseScope } from '@/services/expense-scope'
import type { Session } from '@/lib/auth'

const base: Session = {
  userId: 'user-1',
  organizationId: 'org-1',
  departmentId: 'dept-1',
  role: 'staff',
}

describe('expenseScope', () => {
  it('limits staff to their own records', () => {
    expect(expenseScope(base)).toEqual({ userId: 'user-1' })
  })

  it('gives managers their department plus their own records', () => {
    expect(expenseScope({ ...base, role: 'manager' })).toEqual({
      $or: [{ departmentId: 'dept-1' }, { userId: 'user-1' }],
    })
  })

  it('keeps only a department-less manager’s own records', () => {
    const scope = expenseScope({
      ...base,
      role: 'manager',
      departmentId: null,
    })
    // Must not mean "every expense whose author has no department".
    expect(scope).toEqual({ userId: 'user-1' })
    expect(scope).not.toEqual({ departmentId: null })
  })

  it('gives admins the whole organization (org filter is applied by the service)', () => {
    expect(expenseScope({ ...base, role: 'admin' })).toEqual({})
  })
})
