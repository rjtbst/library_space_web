// src/lib/actions/auth.ts
'use server'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { UserRole, TablesUpdate } from '@/lib/supabase/types'
import { z } from 'zod'

// ─── Discriminated union result type ─────────────────────────────────────────
// Always narrow with: if (!res.success) { ... res.error ... } else { ... res.data ... }
export type ActionOk<T>   = { success: true;  data: T }
export type ActionErr     = { success: false; error: string }
export type ActionResult<T = undefined> = ActionOk<T> | ActionErr

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const phoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number (+91XXXXXXXXXX)')

const otpSchema = z
  .string()
  .length(6, 'OTP must be exactly 6 digits')
  .regex(/^\d{6}$/, 'OTP must be digits only')

const profileSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(60).trim(),
  city:      z.string().min(2, 'City is required').max(80).trim(),
  state:     z.string().min(2, 'State is required').max(80).trim(),
  phone:     z.string().optional(),
})

export type ProfileFormData = z.infer<typeof profileSchema>

const roleSchema = z.enum(['student', 'owner', 'staff'])

// ─── Helper ───────────────────────────────────────────────────────────────────
function dashboardForRole(role: UserRole | null | undefined): string {
  if (role === 'owner') return '/owner/dashboard'
  if (role === 'staff') return '/staff/scanner'
  return '/student/home'
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
export async function signInWithGoogle(
  redirectAfter?: string
): Promise<ActionResult<{ url: string }>> {
  const supabase   = await createServerSupabaseClient()
  const siteUrl    = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const nextPath   = redirectAfter ?? '/onboarding/role'
  const callbackUrl = `${siteUrl}/api/auth/callback?next=${encodeURIComponent(nextPath)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })

  if (error || !data.url) {
    return { success: false, error: error?.message ?? 'Could not start Google sign-in' }
  }
  return { success: true, data: { url: data.url } }
}

// ─── Send OTP via MSG91 / Supabase phone ──────────────────────────────────────
export async function sendOtp(rawPhone: string): Promise<ActionResult> {
  const parsed = phoneSchema.safeParse(rawPhone)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithOtp({
    phone: parsed.data,
    options: { shouldCreateUser: true },
  })

  if (error) {
    if (error.message.toLowerCase().includes('rate')) {
      return { success: false, error: 'Too many attempts. Please wait 60 seconds.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true, data: undefined }
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────
export async function verifyOtp(
  rawPhone: string,
  token: string
): Promise<ActionResult<{ redirectTo: string }>> {
  const phoneParsed = phoneSchema.safeParse(rawPhone)
  if (!phoneParsed.success) {
    return { success: false, error: phoneParsed.error.errors[0].message }
  }
  const otpParsed = otpSchema.safeParse(token)
  if (!otpParsed.success) {
    return { success: false, error: otpParsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()
  const { data: authData, error: authError } = await supabase.auth.verifyOtp({
    phone: phoneParsed.data,
    token: otpParsed.data,
    type: 'sms',
  })

  if (authError || !authData.user) {
    return { success: false, error: 'Invalid or expired OTP. Please try again.' }
  }

  const { data: row } = await supabase
    .from('profiles')
    .select('onboarded, role')
    .eq('id', authData.user.id)
    .maybeSingle()

  const redirectTo: string = row?.onboarded
    ? dashboardForRole(row.role as UserRole)
    : '/onboarding/role'

  return { success: true, data: { redirectTo } }
}

// ─── Set role (onboarding step 1) ─────────────────────────────────────────────
export async function setRole(
  role: UserRole
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = roleSchema.safeParse(role)
  if (!parsed.success) {
    return { success: false, error: 'Invalid role' }
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return { success: false, error: 'Session expired. Please sign in again.' }
  }

  // Use explicit cast to the Update type so TS doesn't infer never
  const payload: TablesUpdate<'profiles'> = { role: parsed.data }
  const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)

  if (error) {
    return { success: false, error: 'Could not save role. Please try again.' }
  }

  const redirectTo =
    parsed.data === 'owner' ? '/onboarding/owner-profile' :
    parsed.data === 'staff' ? '/onboarding/staff-profile' :
    '/onboarding/profile'

  return { success: true, data: { redirectTo } }
}

// ─── Update profile (onboarding step 2) ──────────────────────────────────────
export async function updateProfile(
  formData: ProfileFormData
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = profileSchema.safeParse(formData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return { success: false, error: 'Session expired. Please sign in again.' }
  }

  // Build a concrete payload typed as the table's Update shape
  const payload: TablesUpdate<'profiles'> = {
    full_name: parsed.data.full_name,
    city:      parsed.data.city,
    state:     parsed.data.state,
    onboarded: true,
    ...(parsed.data.phone?.length ? { phone: parsed.data.phone } : {}),
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', user.id)

  if (updateErr) {
    return { success: false, error: 'Could not save profile. Please try again.' }
  }

  // Read role back separately (avoids update().select() typing chain)
  const { data: row } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  return {
    success: true,
    data: { redirectTo: dashboardForRole(row?.role as UserRole | null) },
  }
}

// ─── Get current profile ──────────────────────────────────────────────────────
export async function getProfile() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  return data
}

// ─── Sign out ─────────────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect('/')
}