// src/app/api/auth/callback/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function safeNext(next: string, origin: string): string {
  if (!next.startsWith('/')) return `${origin}/student/home`
  return `${origin}${next}`
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)

  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/onboarding/role'
  const error = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')

  if (error) {
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
    return NextResponse.redirect(
      `${origin}/auth-error?error=${encodeURIComponent(
        exchangeError?.message ?? 'session_failed'
      )}`
    )
  }

  // Trigger has already created the row — just read it
  const { data: userRow } = await supabase
    .from('users')
    .select('onboarded, role')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!userRow?.onboarded) {
    return NextResponse.redirect(`${origin}/onboarding/role`)
  }

  if (next !== '/onboarding/role') {
    return NextResponse.redirect(safeNext(next, origin))
  }

  switch (userRow.role) {
    case 'owner':  return NextResponse.redirect(`${origin}/dashboard`)
    case 'staff':  return NextResponse.redirect(`${origin}/scanner`)
    default:       return NextResponse.redirect(`${origin}/student/home`)
  }
}