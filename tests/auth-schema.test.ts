import { describe, expect, it } from 'vitest'
import { ChangePasswordSchema } from '@/schemas/auth'

const valid = {
  currentPassword: 'OldPassword1!',
  newPassword: 'NewPassword1!',
  confirmPassword: 'NewPassword1!',
}

describe('ChangePasswordSchema', () => {
  it('accepts matching passwords that meet the policy', () => {
    expect(ChangePasswordSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a confirmation that does not match', () => {
    const result = ChangePasswordSchema.safeParse({
      ...valid,
      confirmPassword: 'Different1!',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors.confirmPassword?.[0]).toBe(
        'Passwords do not match',
      )
    }
  })

  it('rejects a new password shorter than 8 characters', () => {
    expect(
      ChangePasswordSchema.safeParse({
        ...valid,
        newPassword: 'short',
        confirmPassword: 'short',
      }).success,
    ).toBe(false)
  })

  it('rejects reusing the current password', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'SamePassword1!',
      newPassword: 'SamePassword1!',
      confirmPassword: 'SamePassword1!',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const flat = result.error.flatten()
      expect(flat.fieldErrors.newPassword?.[0]).toBe(
        'The new password must be different from the current one',
      )
    }
  })

  it('rejects an empty current password', () => {
    expect(
      ChangePasswordSchema.safeParse({ ...valid, currentPassword: '' }).success,
    ).toBe(false)
  })

  it('rejects client-injected ownership fields (rule 2)', () => {
    for (const extra of [
      { userId: 'someone-else' },
      { organizationId: 'org-1' },
      { mustChangePassword: false },
    ]) {
      expect(
        ChangePasswordSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false)
    }
  })
})
