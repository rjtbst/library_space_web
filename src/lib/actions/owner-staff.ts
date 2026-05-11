'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, getSupabaseUser } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/actions/auth'
import { nowIST } from '@/lib/ist'
import { log, logError } from '@/lib/logger'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

export type StaffMember = {
  staffId:   string
  userId:    string
  fullName:  string
  phone:     string | null
  role:      string | null
  libraryId: string
}

export type PendingRequest = {
  requestId:   string
  userId:      string
  fullName:    string
  phone:       string | null
  message:     string | null
  libraryId:   string
  libraryName: string
  createdAt:   string
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

/** Resolve display name — the users table has both `name` and `full_name` columns. */
function resolveName(u: any): string {
  return u?.full_name?.trim() || u?.name?.trim() || '—'
}

/** Strip spaces / +91 / leading 0 to get a bare 10-digit number. */
function normalisePhone(raw: string): string {
  return raw.replace(/\s/g, '').replace(/^\+91/, '').replace(/^0/, '')
}

/**
 * Fetch a map of userId → user row for a list of IDs.
 *
 * WHY A SEPARATE QUERY INSTEAD OF A JOIN:
 * Supabase PostgREST foreign-table joins respect the RLS policies of the
 * *joined* table. If `users` has a policy like "users can only read their
 * own row", the join silently returns null for every other user — giving
 * you "Unknown" names even though the data exists. Querying `users`
 * directly in a server action (which runs with the authenticated session)
 * lets Supabase evaluate the policy against the *owner* user, who typically
 * has broader read access, or you can grant it explicitly via a policy.
 *
 * If names are STILL null after this change, add this RLS policy in Supabase:
 *   CREATE POLICY "owners and staff can read user profiles"
 *   ON public.users FOR SELECT
 *   USING (true);   -- or scope it more tightly as needed
 */
async function fetchUsersById(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userIds: string[],
): Promise<Record<string, { fullName: string; phone: string | null }>> {
  if (!userIds.length) return {}

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, name, phone')
    .in('id', userIds)

  if (error) {
    logError('fetchUsersById', 'Batch user lookup failed', error)
    return {}
  }

  const map: Record<string, { fullName: string; phone: string | null }> = {}
  for (const u of data ?? []) {
    map[u.id] = {
      fullName: resolveName(u),
      phone:    u.phone ?? null,
    }
  }
  return map
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET ACTIVE STAFF FOR ALL OWNER LIBRARIES
═══════════════════════════════════════════════════════════════════════════ */

export async function getOwnerStaff(): Promise<StaffMember[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data: libs, error: libErr } = await supabase
    .from('libraries').select('id').eq('owner_id', user.id)

  if (libErr || !libs?.length) return []

  const libIds = libs.map(l => l.id)

  const { data, error } = await supabase
    .from('staff')
    .select('id, role, library_id, user_id')   // no join — fetch users separately
    .in('library_id', libIds)
    .order('library_id')

  if (error || !data) return []

  const userIds  = [...new Set(data.map(r => r.user_id).filter(Boolean))]
  const usersMap = await fetchUsersById(supabase, userIds)

  return data.map((row: any) => ({
    staffId:   row.id,
    userId:    row.user_id,
    fullName:  usersMap[row.user_id]?.fullName ?? '—',
    phone:     usersMap[row.user_id]?.phone    ?? null,
    role:      row.role                        ?? null,
    libraryId: row.library_id,
  }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET PENDING REQUESTS FOR ALL OWNER LIBRARIES
═══════════════════════════════════════════════════════════════════════════ */

export async function getPendingRequests(): Promise<PendingRequest[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data: libs } = await supabase
    .from('libraries').select('id, name').eq('owner_id', user.id)

  if (!libs?.length) return []

  const libIds   = libs.map(l => l.id)
  const libNames = Object.fromEntries(libs.map(l => [l.id, l.name ?? '']))

  const { data, error } = await supabase
    .from('staff_requests')
    .select('id, user_id, library_id, message, created_at')  // no join — fetch users separately
    .in('library_id', libIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })   // oldest first → FIFO

  if (error || !data) return []

  const userIds  = [...new Set(data.map(r => r.user_id).filter(Boolean))]
  const usersMap = await fetchUsersById(supabase, userIds)

  return data.map((row: any) => ({
    requestId:   row.id,
    userId:      row.user_id,
    fullName:    usersMap[row.user_id]?.fullName ?? '—',
    phone:       usersMap[row.user_id]?.phone    ?? null,
    message:     row.message                     ?? null,
    libraryId:   row.library_id,
    libraryName: libNames[row.library_id]        ?? '',
    createdAt:   row.created_at                  ?? '',
  }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACCEPT REQUEST
═══════════════════════════════════════════════════════════════════════════ */

export async function acceptStaffRequest(
  requestId: string,
  role = 'staff',
): Promise<ActionResult<{ staffId: string }>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: req, error: reqErr } = await supabase
    .from('staff_requests')
    .select('id, user_id, library_id, status, libraries(owner_id)')
    .eq('id', requestId)
    .maybeSingle()

  if (reqErr || !req) return { success: false, error: 'Request not found' }

  const ownerId = Array.isArray(req.libraries)
    ? (req.libraries[0] as any)?.owner_id
    : (req.libraries as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  if (req.status !== 'pending')
    return { success: false, error: `Request is already ${req.status}` }

  const { data: existingStaff } = await supabase
    .from('staff').select('id')
    .eq('user_id', req.user_id).eq('library_id', req.library_id).maybeSingle()

  if (existingStaff) {
    await supabase.from('staff_requests')
      .update({ status: 'accepted', reviewed_at: nowIST() } as never)
      .eq('id', requestId)
    return { success: true, data: { staffId: existingStaff.id } }
  }

  const { data: newStaff, error: staffErr } = await supabase
    .from('staff')
    .insert({ user_id: req.user_id, library_id: req.library_id, role } as never)
    .select('id').single()

  if (staffErr || !newStaff) {
    logError('acceptStaffRequest', 'Staff insert failed', staffErr)
    return { success: false, error: staffErr?.message ?? 'Failed to add staff' }
  }

  await supabase.from('staff_requests')
    .update({ status: 'accepted', reviewed_at: nowIST() } as never)
    .eq('id', requestId)

  log('acceptStaffRequest', `request=${requestId} → staff=${newStaff.id}`)
  revalidatePath('/dashboard/staff')
  return { success: true, data: { staffId: newStaff.id } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REJECT REQUEST
═══════════════════════════════════════════════════════════════════════════ */

export async function rejectStaffRequest(requestId: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: req } = await supabase
    .from('staff_requests')
    .select('id, status, libraries(owner_id)')
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return { success: false, error: 'Request not found' }

  const ownerId = Array.isArray(req.libraries)
    ? (req.libraries[0] as any)?.owner_id
    : (req.libraries as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  if (req.status !== 'pending')
    return { success: false, error: `Request is already ${req.status}` }

  const { error } = await supabase.from('staff_requests')
    .update({ status: 'rejected', reviewed_at: nowIST() } as never)
    .eq('id', requestId)

  if (error) { logError('rejectStaffRequest', 'Update failed', error); return { success: false, error: error.message } }

  log('rejectStaffRequest', `request=${requestId} rejected by owner=${user.id}`)
  revalidatePath('/dashboard/staff')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADD STAFF DIRECTLY BY PHONE
═══════════════════════════════════════════════════════════════════════════ */

export async function addStaffByPhone(
  phone:     string,
  libraryId: string,
  role = 'staff',
): Promise<ActionResult<{ staffId: string; fullName: string }>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if (!lib || (lib as any).owner_id !== user.id)
    return { success: false, error: 'Library not found or access denied' }

  const normalized = normalisePhone(phone)
  if (normalized.length !== 10 || !/^\d{10}$/.test(normalized))
    return { success: false, error: 'Enter a valid 10-digit Indian mobile number' }

  // Try bare 10-digit first, then +91-prefixed — two safe .eq() calls
  // avoids the PostgREST .or() issue with '+' being a reserved character
  let resolvedUser: any = null

  const { data: u1, error: e1 } = await supabase
    .from('users')
    .select('id, full_name, name, phone, role')
    .eq('phone', normalized)
    .maybeSingle()

  if (e1) { logError('addStaffByPhone', 'Lookup (bare) failed', e1); return { success: false, error: 'Lookup failed — try again' } }
  resolvedUser = u1

  if (!resolvedUser) {
    const { data: u2, error: e2 } = await supabase
      .from('users')
      .select('id, full_name, name, phone, role')
      .eq('phone', `+91${normalized}`)
      .maybeSingle()
    if (e2) { logError('addStaffByPhone', 'Lookup (+91) failed', e2); return { success: false, error: 'Lookup failed — try again' } }
    resolvedUser = u2
  }

  if (!resolvedUser)
    return { success: false, error: `No user found with phone ${normalized}. Ask them to register first.` }

  if (resolvedUser.role !== 'staff')
    return { success: false, error: `This user is registered as '${resolvedUser.role}', not staff.` }

  const { data: existing } = await supabase.from('staff').select('id')
    .eq('user_id', resolvedUser.id).eq('library_id', libraryId).maybeSingle()
  if (existing)
    return { success: false, error: `${resolveName(resolvedUser)} is already staff here` }

  const { data: inserted, error: insertErr } = await supabase
    .from('staff')
    .insert({ user_id: resolvedUser.id, library_id: libraryId, role } as never)
    .select('id')
    .single()

  if (insertErr || !inserted) {
    logError('addStaffByPhone', 'Insert failed', insertErr)
    return { success: false, error: insertErr?.message ?? 'Failed to add staff' }
  }

  const fullName = resolveName(resolvedUser)
  log('addStaffByPhone', `staff=${inserted.id} user=${resolvedUser.id} library=${libraryId}`)
  revalidatePath('/dashboard/staff')
  return { success: true, data: { staffId: inserted.id, fullName } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REMOVE STAFF
═══════════════════════════════════════════════════════════════════════════ */

export async function removeStaff(staffId: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: staffRow } = await supabase.from('staff')
    .select('id, library_id, libraries(owner_id)').eq('id', staffId).maybeSingle()
  if (!staffRow) return { success: false, error: 'Staff record not found' }

  const ownerId = Array.isArray(staffRow.libraries)
    ? (staffRow.libraries[0] as any)?.owner_id
    : (staffRow.libraries as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase.from('staff').delete().eq('id', staffId)
  if (error) { logError('removeStaff', 'Delete failed', error); return { success: false, error: error.message } }

  log('removeStaff', `staff=${staffId} removed by owner=${user.id}`)
  revalidatePath('/dashboard/staff')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPDATE STAFF ROLE
═══════════════════════════════════════════════════════════════════════════ */

export async function updateStaffRole(staffId: string, role: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: staffRow } = await supabase.from('staff')
    .select('id, library_id, libraries(owner_id)').eq('id', staffId).maybeSingle()
  if (!staffRow) return { success: false, error: 'Staff record not found' }

  const ownerId = Array.isArray(staffRow.libraries)
    ? (staffRow.libraries[0] as any)?.owner_id
    : (staffRow.libraries as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase.from('staff').update({ role } as never).eq('id', staffId)
  if (error) { logError('updateStaffRole', 'Update failed', error); return { success: false, error: error.message } }

  log('updateStaffRole', `staff=${staffId} role=${role}`)
  revalidatePath('/dashboard/staff')
  return { success: true, data: undefined }
}