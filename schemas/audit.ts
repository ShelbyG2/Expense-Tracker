import { z } from 'zod'
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '@/lib/constants'
import { parseDateOnly } from '@/schemas/expense'

// Shared between the /admin/audit filter form (server page) and the API route.
// The audit log is read-only; this schema only shapes filters and paging.

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
  .refine((value) => parseDateOnly(value) !== null, 'Enter a valid date')
  .transform((value) => parseDateOnly(value) as Date)

export const AuditQuerySchema = z
  .object({
    userId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Choose a user from the list')
      .optional(),
    entity: z
      .enum(AUDIT_ENTITIES, { error: 'Choose a valid entity' })
      .optional(),
    action: z
      .enum(AUDIT_ACTIONS, { error: 'Choose a valid action' })
      .optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The "from" date must be on or before the "to" date',
  })
export type AuditQuery = z.infer<typeof AuditQuerySchema>
