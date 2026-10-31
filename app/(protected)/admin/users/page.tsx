import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { listDepartments, listUsers } from '@/services/admin-service'
import { CreateUserForm } from '@/components/admin/create-user-form'
import { UsersTable } from '@/components/admin/users-table'

// Reads the session cookie on every request — blocking route (cacheComponents).
export const instant = false

// /admin/users — create users, assign roles and departments, deactivate.
// Middleware 403s non-admins; this re-check is defense-in-depth.
export default async function AdminUsersPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/dashboard')

  const [users, departments] = await Promise.all([
    listUsers(session),
    listDepartments(session),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Everyone who can use Expense Tracker in your organization. Deactivated
          users cannot sign in.
        </p>
      </div>

      <CreateUserForm departments={departments} />

      <UsersTable
        users={users}
        departments={departments}
        currentUserId={session.userId}
      />
    </div>
  )
}
