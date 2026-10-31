import { NextResponse, type NextRequest } from 'next/server'
import { clearSession } from '@/lib/session'

// Reached from lib/session.ts when the signed-in user has been deactivated.
// Render cannot clear cookies, so the page redirects here instead: this route
// clears the session cookie (which also breaks proxy's valid-JWT redirect
// loop) and forwards the user to the login page with a message.
export async function GET(req: NextRequest) {
  await clearSession()
  return NextResponse.redirect(
    new URL('/login?reason=deactivated', req.url),
    303,
  )
}
