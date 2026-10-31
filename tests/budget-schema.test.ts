import { describe, expect, it } from 'vitest'
import {
  BudgetListQuerySchema,
  CopyBudgetsSchema,
  CreateBudgetSchema,
  UpdateBudgetSchema,
} from '@/schemas/budget'

describe('CreateBudgetSchema', () => {
  it('accepts a valid budget and coerces the amount', () => {
    const parsed = CreateBudgetSchema.parse({
      category: 'Meals',
      amount: '250.50',
      month: '2026-10',
    })
    expect(parsed).toEqual({
      category: 'Meals',
      amount: 250.5,
      month: '2026-10',
    })
  })

  it('requires a positive amount', () => {
    for (const amount of [0, -1, '0', 'abc']) {
      expect(
        CreateBudgetSchema.safeParse({
          category: 'Meals',
          amount,
          month: '2026-10',
        }).success,
      ).toBe(false)
    }
  })

  it('requires a YYYY-MM month', () => {
    for (const month of ['2026-13', '2026-00', '2026-1', 'October', '']) {
      expect(
        CreateBudgetSchema.safeParse({
          category: 'Meals',
          amount: 100,
          month,
        }).success,
      ).toBe(false)
    }
  })

  it('rejects a category outside the fixed list', () => {
    expect(
      CreateBudgetSchema.safeParse({
        category: 'Travel',
        amount: 100,
        month: '2026-10',
      }).success,
    ).toBe(false)
  })

  it('rejects client-supplied ownership fields (rule 2)', () => {
    for (const extra of [
      { departmentId: 'dept-1' },
      { organizationId: 'org-1' },
      { createdAt: '2026-10-01' },
    ]) {
      expect(
        CreateBudgetSchema.safeParse({
          category: 'Meals',
          amount: 100,
          month: '2026-10',
          ...extra,
        }).success,
      ).toBe(false)
    }
  })
})

describe('carryOver (Phase 7C)', () => {
  it('accepts the rollover flag on create and update', () => {
    expect(
      CreateBudgetSchema.parse({
        category: 'Meals',
        amount: 100,
        month: '2026-10',
        carryOver: true,
      }).carryOver,
    ).toBe(true)
    expect(UpdateBudgetSchema.parse({ carryOver: false })).toEqual({
      carryOver: false,
    })
  })

  it('rejects a non-boolean flag', () => {
    expect(
      CreateBudgetSchema.safeParse({
        category: 'Meals',
        amount: 100,
        month: '2026-10',
        carryOver: 'yes',
      }).success,
    ).toBe(false)
  })
})

describe('CopyBudgetsSchema', () => {
  it('accepts two valid months', () => {
    expect(
      CopyBudgetsSchema.parse({ fromMonth: '2026-09', toMonth: '2026-10' }),
    ).toEqual({ fromMonth: '2026-09', toMonth: '2026-10' })
  })

  it('rejects invalid months and extra fields', () => {
    expect(
      CopyBudgetsSchema.safeParse({ fromMonth: '2026-13', toMonth: '2026-10' })
        .success,
    ).toBe(false)
    expect(
      CopyBudgetsSchema.safeParse({
        fromMonth: '2026-09',
        toMonth: '2026-10',
        departmentId: 'dept-1',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateBudgetSchema', () => {
  it('accepts a partial update', () => {
    expect(UpdateBudgetSchema.parse({ amount: 500 })).toEqual({ amount: 500 })
  })

  it('requires at least one field', () => {
    expect(UpdateBudgetSchema.safeParse({}).success).toBe(false)
  })

  it('still validates the fields that are present', () => {
    expect(UpdateBudgetSchema.safeParse({ amount: -5 }).success).toBe(false)
    expect(UpdateBudgetSchema.safeParse({ month: '2026-14' }).success).toBe(
      false,
    )
  })
})

describe('BudgetListQuerySchema', () => {
  it('accepts an empty query and valid filters', () => {
    expect(BudgetListQuerySchema.parse({})).toEqual({})
    expect(
      BudgetListQuerySchema.parse({ month: '2026-10', category: 'Meals' }),
    ).toEqual({ month: '2026-10', category: 'Meals' })
  })

  it('rejects an invalid month or category', () => {
    expect(BudgetListQuerySchema.safeParse({ month: '2026-13' }).success).toBe(
      false,
    )
    expect(
      BudgetListQuerySchema.safeParse({ category: 'Travel' }).success,
    ).toBe(false)
  })
})
