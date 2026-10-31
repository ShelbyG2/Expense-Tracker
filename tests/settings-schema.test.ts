import { describe, expect, it } from 'vitest'
import { UpdateSettingsSchema } from '@/schemas/settings'

describe('UpdateSettingsSchema', () => {
  it('accepts a threshold inside the allowed 0.5–0.95 range', () => {
    expect(UpdateSettingsSchema.parse({ warningThreshold: 0.8 })).toEqual({
      warningThreshold: 0.8,
    })
    expect(
      UpdateSettingsSchema.safeParse({ warningThreshold: 0.5 }).success,
    ).toBe(true)
    expect(
      UpdateSettingsSchema.safeParse({ warningThreshold: 0.95 }).success,
    ).toBe(true)
  })

  it('rejects thresholds outside the range', () => {
    for (const warningThreshold of [0.49, 0.96, 0, 1, -0.2, 80]) {
      expect(UpdateSettingsSchema.safeParse({ warningThreshold }).success).toBe(
        false,
      )
    }
  })

  it('rejects non-numbers and extra fields', () => {
    expect(
      UpdateSettingsSchema.safeParse({ warningThreshold: 'high' }).success,
    ).toBe(false)
    expect(UpdateSettingsSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSettingsSchema.safeParse({
        warningThreshold: 0.8,
        organizationId: 'org-1',
      }).success,
    ).toBe(false)
  })

  it('accepts a three-letter currency code and normalises its case', () => {
    expect(UpdateSettingsSchema.parse({ currency: 'kes' })).toEqual({
      currency: 'KES',
    })
    expect(UpdateSettingsSchema.parse({ currency: ' USD ' })).toEqual({
      currency: 'USD',
    })
  })

  it('rejects malformed currency codes', () => {
    for (const currency of ['KE', 'KESS', 'K3S', '', 'K S']) {
      expect(UpdateSettingsSchema.safeParse({ currency }).success).toBe(false)
    }
    expect(UpdateSettingsSchema.safeParse({ currency: 42 }).success).toBe(false)
  })

  it('allows both settings in one request', () => {
    expect(
      UpdateSettingsSchema.parse({ warningThreshold: 0.75, currency: 'eur' }),
    ).toEqual({ warningThreshold: 0.75, currency: 'EUR' })
  })
})
