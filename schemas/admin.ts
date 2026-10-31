import { z } from 'zod'
import { USER_ROLES } from '@/lib/constants'

// Shared between the admin pages (client) and the admin API routes (server).
// Role values come from lib/constants so the client never imports models/.

// A department id is a 24-char ObjectId, or null for "no department".
// Regex instead of mongoose.isValidObjectId — this file ships to the browser.
export const DepartmentIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Choose a department')
  .nullable()

const nameField = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name is too long')

const emailField = z.email({ error: 'Enter a valid email address' })

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')

// Admin creates a user with an initial password, a role and (optionally) a
// department. `.strict()` so clients cannot inject organizationId/isActive.
export const CreateUserSchema = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    role: z.enum(USER_ROLES, { error: 'Choose a valid role' }),
    departmentId: DepartmentIdSchema,
  })
  .strict()
export type CreateUserInput = z.infer<typeof CreateUserSchema>

// Admin edits profile, role, department or active status. Password changes
// are not part of this phase, so password is deliberately absent.
export const UpdateUserSchema = z
  .object({
    name: nameField,
    email: emailField,
    role: z.enum(USER_ROLES, { error: 'Choose a valid role' }),
    departmentId: DepartmentIdSchema,
    isActive: z.boolean({ error: 'Active must be true or false' }),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>

// Admin resets a user's password: send { password } to choose the temporary
// password, or {} to have the server generate one. Either way the user must
// change it at next sign-in. `.strict()` so nothing else can be injected.
export const ResetPasswordSchema = z
  .object({
    password: passwordField.optional(),
  })
  .strict()
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>

// Creating and renaming a department take the same shape.
export const DepartmentNameSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Department name must be at least 2 characters')
      .max(80, 'Department name is too long'),
  })
  .strict()
export type DepartmentNameInput = z.infer<typeof DepartmentNameSchema>
