import { z } from 'zod'
import {
  WARNING_THRESHOLD_MAX,
  WARNING_THRESHOLD_MIN,
} from '@/lib/budget-status'

// Organization settings (Phase 7C/7D). Both fields are optional so a client can
// patch just one; at least one must be present. `.strict()` so nothing else
// (name, organizationId, ...) can be injected.
const currencyField = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => /^[A-Z]{3}$/.test(value),
    'Use a three-letter ISO currency code (for example KES)',
  )

export const UpdateSettingsSchema = z
  .object({
    warningThreshold: z
      .number({ error: 'Enter a number between 0.5 and 0.95' })
      .min(
        WARNING_THRESHOLD_MIN,
        `Warning threshold must be at least ${WARNING_THRESHOLD_MIN}`,
      )
      .max(
        WARNING_THRESHOLD_MAX,
        `Warning threshold must be at most ${WARNING_THRESHOLD_MAX}`,
      )
      .optional(),
    currency: currencyField.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one setting to update',
  })
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>
