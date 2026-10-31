'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Role = 'admin' | 'manager' | 'staff'

// Role-aware navigation. Each role sees only its permitted destinations.
const LINKS: { href: string; label: string; roles: Role[] }[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    roles: ['admin', 'manager', 'staff'],
  },
  {
    href: '/expenses',
    label: 'Expenses',
    roles: ['admin', 'manager', 'staff'],
  },
  { href: '/budgets', label: 'Budgets', roles: ['admin', 'manager'] },
  { href: '/approvals', label: 'Approvals', roles: ['manager', 'admin'] },
  { href: '/reports', label: 'Reports', roles: ['admin', 'manager'] },
  { href: '/admin/users', label: 'Users', roles: ['admin'] },
  { href: '/admin/departments', label: 'Departments', roles: ['admin'] },
  { href: '/admin/audit', label: 'Audit', roles: ['admin'] },
  { href: '/admin/settings', label: 'Settings', roles: ['admin'] },
]

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname()
  const links = LINKS.filter((l) => l.roles.includes(role))

  return (
    <nav className="flex flex-wrap gap-1">
      {links.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
