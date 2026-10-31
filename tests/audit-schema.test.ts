import { describe, expect, it } from 'vitest'
import { AuditQuerySchema } from '@/schemas/audit'

describe('AuditQuerySchema', () => {
  it('defaults to the first page of 25 entries', () => {
    expect(AuditQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 })
  })

  it('accepts every filter and turns dates into UTC Dates', () => {
    const parsed = AuditQuerySchema.parse({
      userId: '507f1f77bcf86cd799439011',
      entity: 'Expense',
      action: 'approve',
      from: '2026-10-01',
      to: '2026-10-31',
      page: '2',
      pageSize: '50',
    })
    expect(parsed.userId).toBe('507f1f77bcf86cd799439011')
    expect(parsed.entity).toBe('Expense')
    expect(parsed.action).toBe('approve')
    expect(parsed.from?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(parsed.to?.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    expect(parsed.page).toBe(2)
    expect(parsed.pageSize).toBe(50)
  })

  it('rejects unknown actions, entities and user ids', () => {
    expect(AuditQuerySchema.safeParse({ action: 'archive' }).success).toBe(
      false,
    )
    expect(AuditQuerySchema.safeParse({ entity: 'Salary' }).success).toBe(false)
    expect(AuditQuerySchema.safeParse({ userId: 'org-1' }).success).toBe(false)
  })

  it('rejects an impossible date and a backwards range', () => {
    expect(AuditQuerySchema.safeParse({ from: '2026-02-31' }).success).toBe(
      false,
    )
    expect(
      AuditQuerySchema.safeParse({
        from: '2026-10-31',
        to: '2026-10-01',
      }).success,
    ).toBe(false)
  })

  it('clamps the page size to 100', () => {
    expect(AuditQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(AuditQuerySchema.safeParse({ page: '0' }).success).toBe(false)
  })
})
