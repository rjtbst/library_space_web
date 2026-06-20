// src/lib/auth/guards.ts
// Server-side role guards for layouts and role-specific onboarding pages.

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
 * Guards a page/layout to a single role.
 * - No session                -> /login
 * - Authenticated, wrong role -> their real home (homeForRole)
 *
 * Deliberately does NOT check `onboarded` — role-specific routes like
 * /onboarding/add-library are reused post-onboarding (adding another
 * library, etc.) and must stay reachable once the role matches.
 */
export async function requireRole(role: UserRole) {
  const { supabase, user } = await getSupabaseUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name, onboarded')
    .eq('id', user.id)
    .maybeSingle()

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
  const { supabase, user } = await getSupabaseUser()
  if (!user) {
    return { ok: false as const, error: { success: false as const, error: 'Not authenticated' } }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name, onboarded')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || profile.role !== role) {
    return { ok: false as const, error: { success: false as const, error: 'Not authorized' } }
  }

  return { ok: true as const, supabase, user, profile }
}