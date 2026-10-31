import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getOrganizationSettings } from '@/services/organization-service'
import { SettingsForm } from '@/components/admin/settings-form'

// Reads the session cookie on every request — blocking route (cacheComponents).
export const instant = false

// /admin/settings — organization-wide configuration: the budget warning
// threshold and the display currency. Middleware 403s non-admins; this is
// defense-in-depth.
export default async function AdminSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/dashboard')

  const settings = await getOrganizationSettings(session)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Organization-wide settings for {settings.name}.
        </p>
      </div>

      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-semibold">Budget alerts and money</h2>
        <SettingsForm
          initialThreshold={settings.warningThreshold}
          initialCurrency={settings.currency}
        />
      </section>
    </div>
  )
}
