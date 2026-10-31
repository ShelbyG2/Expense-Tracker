// Edge middleware: guards PAGES only (redirects to /login when unauthenticated,
// 403s role-restricted pages). API routes are NOT handled here — they do their
// own authoritative session/role check in lib/guard.ts.
//
// Next 16 convention: this file is proxy.ts and the exported function is
// `proxy` (middleware.ts / `middleware` is deprecated). Behaviour is unchanged.

import { NextResponse, type NextRequest } from 'next/server'
import { verifySession } from '@/lib/auth'

const SESSION_COOKIE = 'session'

// Public pages (no session required).
const PUBLIC_PATHS = new Set(['/login', '/register', '/'])

// Path prefix -> roles allowed. Anything not listed only requires a session.
const ROLE_PATHS: { prefix: string; roles: string[] }[] = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/approvals', roles: ['manager', 'admin'] },
  { prefix: '/budgets', roles: ['manager', 'admin'] },
  { prefix: '/reports', roles: ['manager', 'admin'] },
]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only guard pages here; let API routes handle themselves.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null

  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    // static-ish assets already excluded by matcher; treat root as public
    pathname === '/'

  if (!session) {
    if (isPublic) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Authenticated: keep logged-in users off the auth pages.
  if (pathname === '/login' || pathname === '/register') {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Role-based page access (e.g. /admin is admin-only) -> 403.
  const rule = ROLE_PATHS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  )
  if (rule && !rule.roles.includes(session.role)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  // Exclude API routes, static assets, and Next internals from the matcher
  // (they're handled above / not relevant to page guarding).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
