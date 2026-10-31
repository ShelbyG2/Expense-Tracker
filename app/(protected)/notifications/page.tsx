import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { listNotifications } from '@/services/notification-service'
import { NotificationQuerySchema } from '@/schemas/notification'
import { NotificationIcon } from '@/components/notification-icon'
import type { NotificationType } from '@/lib/constants'

// Reads the session cookie and search params on every request.
export const instant = false

const STATUS_LABELS: Record<NotificationType, string> = {
  expense_approved: 'Expense approved',
  expense_rejected: 'Expense rejected',
  expense_pending: 'Expense pending review',
  budget_warning: 'Budget warning',
  budget_exceeded: 'Budget exceeded',
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const raw = await searchParams
  const query = NotificationQuerySchema.safeParse({
    page: parseInt(raw.page ?? '1', 10),
    pageSize: parseInt(raw.pageSize ?? '20', 10),
  })

  if (!query.success) {
    redirect('/notifications?page=1&pageSize=20')
  }

  const result = await listNotifications(session, query.data)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-neutral-500">
          In-app notices for approvals, rejections, pending expenses and budget
          alerts. Read-only for other users.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
            <tr>
              <th scope="col" className="px-4 py-3">
                Type
              </th>
              <th scope="col" className="px-4 py-3">
                Message
              </th>
              <th scope="col" className="px-4 py-3">
                When
              </th>
              <th scope="col" className="w-24 px-4 py-3">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-neutral-500"
                >
                  No notifications.
                </td>
              </tr>
            ) : (
              result.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
                      <NotificationIcon name={item.type} />
                      <span className="text-sm">
                        {STATUS_LABELS[item.type] ?? item.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                    {item.message}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-500 tabular-nums">
                    {formatCreatedAt(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.readAt === null ? (
                      <span className="text-xs font-medium tracking-wide text-amber-600 uppercase dark:text-amber-400">
                        Unread
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">Read</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
        <p>
          {result.total} notification{result.total === 1 ? '' : 's'} · page{' '}
          {result.page} of {result.totalPages}
        </p>
        <div className="flex gap-3">
          {result.page > 1 && (
            <Link
              href={`/notifications?page=${result.page - 1}&pageSize=${result.pageSize}`}
              className="underline"
            >
              Previous
            </Link>
          )}
          {result.page < result.totalPages && (
            <Link
              href={`/notifications?page=${result.page + 1}&pageSize=${result.pageSize}`}
              className="underline"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
