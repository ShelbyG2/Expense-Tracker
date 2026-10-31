import { z } from 'zod'

// Paginated inbox signature: the server pages on `createdAt, _id` (newest
// first), so every page is stable.
export const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
export type NotificationQuery = z.infer<typeof NotificationQuerySchema>

// Used by the bell's "mark as read" and the page's "mark all as read".
// Keep it tiny — the server already scopes every query to the caller's own
// notifications, so nothing leaks.
export const MarkNotificationsReadSchema = z
  .object({
    ids: z
      .array(
        z.string().regex(/^[0-9a-fA-F]{24}$/, 'Use a valid notification id'),
      )
      .min(1)
      .max(50)
      .optional(),
    all: z.boolean().optional(),
  })
  .refine(
    (input) => (input.ids?.length ?? 0) + (input.all ? 1 : 0) > 0,
    'Provide at least one notification id, or set all to true',
  )
export type MarkNotificationsReadInput = z.infer<
  typeof MarkNotificationsReadSchema
>
