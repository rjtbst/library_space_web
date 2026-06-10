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
    case 'staff':  return NextResponse.redirect(`${origin}/staff`)
    default:       return NextResponse.redirect(`${origin}/explore`)
  }
}





// app/auth/callback/route.ts
// Supabase Auth callback handler.
// After successful login, redirect student → /explore, owner → /dashboard.

// import { NextRequest, NextResponse } from 'next/server'
// import { createServerSupabaseClient } from '@/lib/supabase/server'

// export const dynamic = 'force-dynamic'

// export async function GET(req: NextRequest) {
//   const { searchParams, origin } = req.nextUrl
//   const code = searchParams.get('code')
//   const next = searchParams.get('next') ?? ''

//   if (code) {
//     const supabase = await createServerSupabaseClient()
//     const { error } = await supabase.auth.exchangeCodeForSession(code)

//     if (!error) {
//       // If caller specified a redirect target, honour it
//       if (next && next.startsWith('/')) {
//         return NextResponse.redirect(`${origin}${next}`)
//       }

//       // Otherwise route by role
//       const { data: { user } } = await supabase.auth.getUser()
//       if (user) {
//         const { data: profile } = await supabase
//           .from('users')
//           .select('role')
//           .eq('id', user.id)
//           .maybeSingle()

//         const role = (profile as any)?.role as string | undefined

//         if (role === 'owner') {
//           return NextResponse.redirect(`${origin}/dashboard`)
//         }
//         if (role === 'staff') {
//           return NextResponse.redirect(`${origin}/staff`)
//         }
//         // Default: student
//         return NextResponse.redirect(`${origin}/explore`)
//       }
//     }
//   }

//   // Auth error → back to login
//   return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
// }