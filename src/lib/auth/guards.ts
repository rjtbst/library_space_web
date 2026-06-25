// src/lib/auth/guards.ts
// Server-side role guards for layouts and role-specific onboarding pages.

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getSupabaseUser } from '@/lib/supabase/server'
import type { Enums } from '@/lib/supabase/types'

type UserRole = Enums<'user_role'>

/** Where a user with this role actually lives in the app. */
export function homeForRole(role: UserRole | null | undefined): string {
  if (role === 'owner') return '/dashboard'
  if (role === 'staff') return '/staff'
  return '/explore'
}

/**
 * Fetches the current user's profile row, deduped per-request with
 * React's cache(). A layout and a page (or multiple nested layouts) in the
 * same request tree often each need this — without cache(), every one of
 * them re-runs the same `users` SELECT. This doesn't speed up navigation
 * from one request to the next (cache() resets per request, by design —
 * it must, otherwise a stale role could leak into a request after a role
 * change), but it removes duplicate round-trips within a single page load,
 * which is the part actually under our control here.
 */
const getProfile = cache(async () => {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { supabase, user: null, profile: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name, onboarded')
    .eq('id', user.id)
    .maybeSingle()

  return { supabase, user, profile }
})

/**
 * Guards a page/layout to a single role.
 * - No session                -> /login
 * - Authenticated, wrong role -> their real home (homeForRole)
 *
 * Deliberately does NOT check `onboarded` — role-specific routes like
 * /onboarding/add-library are reused post-onboarding (adding another
 * library, etc.) and must stay reachable once the role matches.
 */
export async function requireRole(role: UserRole) {
  const { supabase, user, profile } = await getProfile()
  if (!user) redirect('/login')
  if (!profile) redirect('/login')
  if (profile.role !== role) redirect(homeForRole(profile.role))

  return { supabase, user, profile }
}

/**
 * Server-action variant of requireRole — for use inside 'use server' actions,
 * where you can't navigate away, only return an error to the caller.
 *
 *   const gate = await requireActionRole('owner')
 *   if (!gate.ok) return gate.error
 *   const { supabase, user } = gate
 */
export async function requireActionRole(role: UserRole) {
  const { supabase, user, profile } = await getProfile()
  if (!user) {
    return { ok: false as const, error: { success: false as const, error: 'Not authenticated' } }
  }

  if (!profile || profile.role !== role) {
    return { ok: false as const, error: { success: false as const, error: 'Not authorized' } }
  }

  return { ok: true as const, supabase, user, profile }
}