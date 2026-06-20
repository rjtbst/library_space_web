// src/middleware.ts
// Runs on EVERY request. Refreshes Supabase session and enforces authentication
// (role-based authorization happens at the layout level — see dashboard/staff/student layouts).

import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Infrastructure routes — no user cookies, skip session refresh entirely
const INFRA_PREFIXES = ['/api/cron', '/api/payment/razorpay-webhook']

// Routes that require authentication — these are the REAL URL prefixes that
// appear in requests, not the (owner)/(student) route group folder names.
const PROTECTED_PREFIXES = [
  '/dashboard',     // owner
  '/staff',         // staff
  '/onboarding',    // any authenticated user
  '/explore',       // student
  '/home',          // student
  '/library',       // student — library detail + booking flow
  '/bookings',      // student
  '/my-books',      // student
  '/payments',      // student
  '/profile',       // student
  '/subscriptions', // student
]

// Routes accessible only when NOT authenticated
const AUTH_ONLY_ROUTES = ['/login']

// Matches on exact path or path + '/', so '/explore' doesn't also match
// something like '/exploreXYZ'.
function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 0. Infra routes (cron, webhooks) — no cookies to refresh, skip straight through
  if (matchesPrefix(pathname, INFRA_PREFIXES)) {
    return NextResponse.next()
  }

  // 1. Refresh Supabase session + get current user
  const { user, response } = await updateSession(request)

  // 2. Public routes — no checks needed
  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES)
  const isAuthRoute = matchesPrefix(pathname, AUTH_ONLY_ROUTES)

  // 3. Unauthenticated user trying to access a protected route
  if (!user && isProtected) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 4. Authenticated user trying to access login (redirect to appropriate home)
  if (user && isAuthRoute && !request.nextUrl.searchParams.get('redirect')) {
    // We can't read the profile role here without another DB call —
    // handle redirect in the login page client-side after verifying session
    // (keeping middleware lean — profile role check is in Server Actions)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, site.webmanifest, robots.txt, sitemap.xml
     * - public files (og-image, logo, etc.)
     */
    '/((?!_next/static|_next/image|favicon|site.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)).*)',
  ],
}