import { describe, expect, it } from 'vitest'
import { reportScope } from '@/services/report-scope'
import type { Session } from '@/lib/auth'

const base: Session = {
  userId: 'user-1',
  organizationId: 'org-1',
  departmentId: 'dept-1',
  role: 'staff',
}

describe('reportScope', () => {
  it('limits staff to their own department', () => {
    expect(reportScope(base)).toEqual({ departmentId: 'dept-1' })
  })

  it('limits managers to their own department', () => {
    expect(reportScope({ ...base, role: 'manager' })).toEqual({
      departmentId: 'dept-1',
    })
  })

  it('gives admins the whole organization (org filter is applied by the service)', () => {
    expect(reportScope({ ...base, role: 'admin' })).toEqual({})
  })

  it('matches nothing for a user with no department', () => {
    const scope = reportScope({ ...base, departmentId: null })
    // Must not mean "every record whose department is null".
    expect(scope.departmentId).not.toBeNull()
    expect(scope.departmentId).toEqual({ $in: [] })
  })
})
