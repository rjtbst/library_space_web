// src/app/api/auth/callback/route.ts
// Handles the OAuth redirect from Google (and magic link emails).
// Exchanges the one-time code for a Supabase session, then redirects
// the user to the correct page based on onboarding status.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/onboarding/role'
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')

  // OAuth provider returned an error
  if (error) {
    console.error('[auth/callback] OAuth error:', error, errorDesc)
    return NextResponse.redirect(
      `${origin}/auth-error?error=${encodeURIComponent(errorDesc ?? error)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth-error?error=missing_code`)
  }

  const supabase = await createServerSupabaseClient()
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.user) {
    console.error('[auth/callback] Exchange error:', exchangeError)
    return NextResponse.redirect(
      `${origin}/auth-error?error=${encodeURIComponent(exchangeError?.message ?? 'session_failed')}`
    )
  }

  // Check profile onboarding status
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded, role')
    .eq('id', data.user.id)
    .single() 

  let redirectTo: string

  if (!profile || !profile.onboarded) {
    // New user — go through onboarding
    redirectTo = `${origin}/onboarding/role`
  } else {
    // Existing user — go to their dashboard
    switch (profile?.role) {
      case 'owner': redirectTo = `${origin}/owner/dashboard`; break
      case 'staff': redirectTo = `${origin}/staff/scanner`; break
      default:      redirectTo = `${origin}/student/home`; break
    }
  }

  // If a specific 'next' was passed and user is already onboarded, use it
  if (profile?.onboarded && next !== '/onboarding/role') {
    redirectTo = next.startsWith('http') ? next : `${origin}${next}`
  }

  return NextResponse.redirect(redirectTo)
}