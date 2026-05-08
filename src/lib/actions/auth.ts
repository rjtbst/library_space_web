'use server'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Enums, TablesUpdate } from '@/lib/supabase/types'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────
type UserRole = Enums<'user_role'>

export type ActionOk<T> = { success: true; data: T }
export type ActionErr = { success: false; error: string }
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
  full_name: z.string().min(1).max(120).trim(),
  city:      z.string().max(80).trim().optional().default(''),
  state:     z.string().max(80).trim().optional().default(''),
  phone:     z.string().optional(),
  email:     z.string().email().optional(),
})

export type ProfileFormData = z.infer<typeof profileSchema>

const roleSchema = z.enum(['student', 'owner', 'staff'])

// ─── Helper ───────────────────────────────────────────────────────────────────
function dashboardForRole(role: UserRole | null | undefined): string {
  if (role === 'owner') return '/dashboard'
  if (role === 'staff') return '/scanner'
  return '/student/home'
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
export async function signInWithGoogle(
  redirectAfter?: string
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createServerSupabaseClient()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const nextPath = redirectAfter ?? '/onboarding/role'
  const callbackUrl = `${siteUrl}/api/auth/callback?next=${encodeURIComponent(nextPath)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl },
  })

  if (error || !data.url) {
    return { success: false, error: error?.message ?? 'Google login failed' }
  }

  return { success: true, data: { url: data.url } }
}

// ─── Send OTP ─────────────────────────────────────────────────────────────────
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

  const { data: authData, error } = await supabase.auth.verifyOtp({
    phone: phoneParsed.data,
    token: otpParsed.data,
    type: 'sms',
  })

  if (error || !authData.user) {
    return { success: false, error: 'Invalid or expired OTP' }
  }

  const { data: row } = await supabase
    .from('users')
    .select('onboarded, role')
    .eq('id', authData.user.id)
    .maybeSingle()

  const redirectTo = row?.onboarded ? dashboardForRole(row.role) : '/onboarding/role'

  return { success: true, data: { redirectTo } }
}

// ─── Set Role ─────────────────────────────────────────────────────────────────
export async function setRole(
  role: UserRole
): Promise<ActionResult<{ redirectTo: string }>> {
  const roleResult = roleSchema.safeParse(role)
  if (!roleResult.success) {
    return { success: false, error: 'Invalid role' }
  }

  const supabase = await createServerSupabaseClient()

  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return { success: false, error: 'Session expired. Please sign in again.' }
  }

  const { error, data: rows } = await supabase
    .from('users')
    .update({ role: roleResult.data })
    .eq('id', user.id)
    .select('id')

  if (error) {
    console.error('setRole DB error:', error)
    return { success: false, error: 'Could not save role. Please try again.' }
  }

  if (!rows || rows.length === 0) {
    const { error: insertError } = await supabase.from('users').insert({
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
      role: roleResult.data,
    })

    if (insertError) {
      console.error('setRole insert fallback error:', insertError)
      return { success: false, error: 'Could not save role. Please try again.' }
    }
  }

  const redirectTo =
    roleResult.data === 'owner' ? '/onboarding/owner-profile' :
    roleResult.data === 'staff' ? '/onboarding/staff-profile' :
    '/onboarding/profile'

  return { success: true, data: { redirectTo } }
}

// ─── Update Profile ───────────────────────────────────────────────────────────
export async function updateProfile(
  formData: ProfileFormData
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = profileSchema.safeParse(formData)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload: TablesUpdate<'users'> = {
    full_name: parsed.data.full_name,
    ...(parsed.data.city  ? { city: parsed.data.city }   : {}),
    ...(parsed.data.state ? { state: parsed.data.state } : {}),
    onboarded: true,
    ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
  }

  const { error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', user.id)

  if (error) {
    return { success: false, error: error.message }
  }

  // Update email in auth if provided (email is on auth.users, not public.users)
  if (parsed.data.email) {
    await supabase.auth.updateUser({ email: parsed.data.email })
  }

  const { data: row } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  return {
    success: true,
    data: { redirectTo: dashboardForRole(row?.role) },
  }
}

// ─── Get Profile ──────────────────────────────────────────────────────────────
export async function getProfile() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  return data
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────
export async function signOut() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect('/')
}