import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/session'
import { Nav } from '@/components/nav'
import { LogoutButton } from '@/components/logout-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { ToastProvider } from '@/components/toast'
import { NotificationBell } from '@/components/notification-bell'
import { unreadNotificationCount } from '@/lib/notification'
import { listNotifications } from '@/services/notification-service'

// Authenticated shell for all protected pages. Middleware already guards
// routes; this is defense-in-depth and provides the role-aware chrome.
//
// This layout reads the session cookie on every request, so the route can't be
// prerendered. With cacheComponents enabled, mark it as a blocking route.
export const instant = false

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  // An admin-set temporary password blocks every other page until it is
  // changed. This forced page lives outside the (protected) group so it is
  // the one page the redirect below does not swallow.
  if (session.mustChangePassword) redirect('/account/change-password')

  // ToastProvider wraps the shell so a toast survives client-side navigation
  // within the protected area (the layout stays mounted across route changes).
  const unreadResult = await unreadNotificationCount(session)
  const latest = await listNotifications(session, { page: 1, pageSize: 10 })

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-semibold">Expense Tracker</span>
              <Nav role={session.role} />
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link
                href="/account"
                className="rounded-md px-2 py-1.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Account
              </Link>
              <span className="text-neutral-500 capitalize">
                {session.role}
              </span>
              <ThemeToggle />
              <NotificationBell
                unreadCount={unreadResult}
                latest={latest.items}
              />
              <LogoutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
      </div>
    </ToastProvider>
  )
}
