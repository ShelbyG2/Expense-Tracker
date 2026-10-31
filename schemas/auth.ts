import { z } from 'zod'

// Shared between the client forms and the server route handlers.

export const RegisterSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name is too long'),
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long'),
  email: z.email({ error: 'Enter a valid email address' }),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
})
export type RegisterInput = z.infer<typeof RegisterSchema>

export const LoginSchema = z.object({
  email: z.email({ error: 'Enter a valid email address' }),
  password: z.string().min(1, 'Password is required'),
})
export type LoginInput = z.infer<typeof LoginSchema>

// Changing your own password (all roles, /account). The current password is
// required so a stolen session cannot lock the real owner out.
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password is too long'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'The new password must be different from the current one',
    path: ['newPassword'],
  })
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>
