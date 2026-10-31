import { describe, expect, it } from 'vitest'
import { ResetPasswordSchema } from '@/schemas/admin'

describe('ResetPasswordSchema', () => {
  it('accepts an empty body so the server generates the password', () => {
    expect(ResetPasswordSchema.parse({})).toEqual({})
  })

  it('accepts an admin-supplied temporary password', () => {
    expect(ResetPasswordSchema.parse({ password: 'Temp-Abc12345' })).toEqual({
      password: 'Temp-Abc12345',
    })
  })

  it('enforces the password policy on a supplied password', () => {
    expect(ResetPasswordSchema.safeParse({ password: 'short' }).success).toBe(
      false,
    )
    expect(
      ResetPasswordSchema.safeParse({ password: 'x'.repeat(129) }).success,
    ).toBe(false)
  })

  it('rejects injected fields such as mustChangePassword or role', () => {
    expect(
      ResetPasswordSchema.safeParse({ mustChangePassword: false }).success,
    ).toBe(false)
    expect(ResetPasswordSchema.safeParse({ role: 'admin' }).success).toBe(false)
  })
})
