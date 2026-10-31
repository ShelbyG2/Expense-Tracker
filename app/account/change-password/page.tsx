import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { ChangePasswordForm } from '@/components/change-password-form'

// Reads the session cookie on every request — blocking route (cacheComponents).
export const instant = false

// /account/change-password — the forced change page. It deliberately lives
// OUTSIDE the (protected) group: app/(protected)/layout.tsx redirects users
// with mustChangePassword to this route, so it must not be behind that
// redirect (it would swallow itself).
export default async function ChangePasswordPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.mustChangePassword) redirect('/account')

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Change your password
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            A temporary password was set for your account. Choose a new password
            to continue — you cannot use the app until you do.
          </p>
        </div>

        <ChangePasswordForm />
      </div>
    </main>
  )
}
