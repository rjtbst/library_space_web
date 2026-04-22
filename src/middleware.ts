// src/middleware.ts
// Runs on EVERY request. Refreshes Supabase session and enforces role-based routing.

import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Routes that require authentication
const PROTECTED_PREFIXES = ['/student', '/owner', '/staff', '/onboarding']

// Routes accessible only when NOT authenticated
const AUTH_ONLY_ROUTES = ['/login']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Refresh Supabase session + get current user
  const { user, response } = await updateSession(request)

  // 2. Public routes — no checks needed
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  const isAuthRoute = AUTH_ONLY_ROUTES.some(p => pathname.startsWith(p))

  // 3. Unauthenticated user trying to access protected route
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