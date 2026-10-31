import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { ChangePasswordForm } from '@/components/change-password-form'

// Reads the session cookie on every request — blocking route (cacheComponents).
export const instant = false

// /account — available to every role: change your own password.
export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Change your password. Your current password is required.
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  )
}
