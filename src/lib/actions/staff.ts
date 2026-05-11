'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/actions/auth'
import { nowIST, todayRangeIST, validateISTRange } from '@/lib/ist'
import { log, logError } from '@/lib/logger'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

export type AssignedLibrary = {
  id: string; name: string; area: string; city: string; assigned: boolean
}

export type StaffLibrary = {
  staffId: string; libraryId: string; libraryName: string
  area: string; city: string; role: string | null
}

export type StaffDashboardStats = {
  todayBookings: number; checkedIn: number; pendingCheckIns: number
  currentlyOccupied: number; totalActiveSeats: number; heldSeats: number
}

export type StaffBooking = {
  id: string; seatLabel: string; studentName: string; phone: string | null
  startTime: string; endTime: string; status: string; bookingMode: string; plan: string | null
}

export type StaffSeatRow = {
  id: string; rowLabel: string; colNumber: number; isActive: boolean
  liveStatus: 'free' | 'booked' | 'held' | 'inactive'
  currentBooking?: {
    id: string; guestName: string | null; phone: string | null
    startTime: string; endTime: string; status: string
  }
}

export type LibraryBook = {
  copyId: string; bookId: string; title: string
  author: string | null; isbn: string | null; status: string
}

export type ActiveIssue = {
  issueId: string; title: string; author: string | null
  issuedTo: string; issuedAt: string; dueDate: string | null
}

export type StaffWalkInInput = {
  seatId: string; libraryId: string; guestName: string; guestPhone: string
  startTime: string; endTime: string; amountPaid: number
  paymentMode: 'cash' | 'upi' | 'other'
}

/* ─── Request flow types ─────────────────────────────────────────────────── */

export type StaffRequestStatus = 'pending' | 'accepted' | 'rejected'

/**
 * The staff_requests table columns:
 *   id, user_id, library_id, status, message, created_at, reviewed_at
 * No rejection_reason column — message is used for staff's note only.
 */
export type MyStaffRequest = {
  requestId:   string
  libraryId:   string
  libraryName: string
  area:        string
  city:        string
  status:      StaffRequestStatus
  message:     string | null
  createdAt:   string
}

export type LibrarySearchResult = {
  id: string; name: string; area: string; city: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAFF PROFILE SETUP
   Replaces the generic updateProfile call during staff onboarding.
   Collects name (required), phone (required), email (optional).
═══════════════════════════════════════════════════════════════════════════ */

export async function setupStaffProfile(input: {
  fullName: string
  phone:    string
  email?:   string
}): Promise<ActionResult<{ redirectTo: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('users')
    .update({
      full_name: input.fullName.trim(),
      phone:     input.phone.trim(),
      ...(input.email ? { email: input.email.trim() } : {}),
      onboarded: true,
    } as never)
    .eq('id', user.id)

  if (error) {
    logError('setupStaffProfile', 'Update failed', error)
    return { success: false, error: error.message }
  }

  log('setupStaffProfile', `user=${user.id}`)
  return { success: true, data: { redirectTo: '/staff' } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAFF IDENTITY
═══════════════════════════════════════════════════════════════════════════ */

/** Returns the library the current staff user is assigned to, or null. */
export async function getStaffLibrary(): Promise<StaffLibrary | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('staff')
    .select('id, role, library_id, libraries(id, name, area, city)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const lib = data.libraries as any
  if (!lib) return null

  return {
    staffId:     data.id,
    libraryId:   lib.id,
    libraryName: lib.name   ?? '',
    area:        lib.area   ?? '',
    city:        lib.city   ?? '',
    role:        data.role  ?? null,
  }
}

/** Used by onboarding profile page to show already-assigned libraries. */
export async function getStaffAssignedLibraries(): Promise<AssignedLibrary[]> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('staff')
    .select('library_id, libraries(id, name, area, city)')
    .eq('user_id', user.id)

  if (error || !data) return []
  return data
    .filter((r: any) => r.libraries)
    .map((r: any) => ({
      id: r.libraries.id, name: r.libraries.name,
      area: r.libraries.area ?? '', city: r.libraries.city ?? '', assigned: true,
    }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   REQUEST FLOW
   Staff searches for a library → submits a join request →
   Owner reviews in their dashboard → accepts (inserts into staff table)
   or rejects → staff sees the result here.
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Get this staff user's most recent request (any status).
 * Returns null if no request has been submitted.
 */
export async function getMyStaffRequest(): Promise<MyStaffRequest | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('staff_requests')
    .select('id, library_id, status, message, created_at, libraries(id, name, area, city)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const lib = data.libraries as any

  return {
    requestId:   data.id,
    libraryId:   data.library_id,
    libraryName: lib?.name ?? '',
    area:        lib?.area ?? '',
    city:        lib?.city ?? '',
    status:      data.status as StaffRequestStatus,
    message:     data.message ?? null,
    createdAt:   data.created_at ?? '',
  }
}

/**
 * Submit a join request to a library.
 * Removes any previous rejected request for the same library before inserting.
 */
export async function submitStaffRequest(
  libraryId: string,
  message?:  string,
): Promise<ActionResult<{ requestId: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Library must exist and be active
  const { data: lib } = await supabase
    .from('libraries').select('id, is_active').eq('id', libraryId).maybeSingle()
  if (!lib)           return { success: false, error: 'Library not found' }
  if (!lib.is_active) return { success: false, error: 'This library is currently inactive' }

  // Already a confirmed staff member?
  const { data: existingStaff } = await supabase
    .from('staff').select('id').eq('user_id', user.id).eq('library_id', libraryId).maybeSingle()
  if (existingStaff)  return { success: false, error: 'You are already staff at this library' }

  // Already has a pending request?
  const { data: pendingReq } = await supabase
    .from('staff_requests').select('id').eq('user_id', user.id)
    .eq('library_id', libraryId).eq('status', 'pending').maybeSingle()
  if (pendingReq)     return { success: false, error: 'You already have a pending request for this library' }

  // Remove any old rejected request so a fresh one can be inserted
  await supabase.from('staff_requests').delete()
    .eq('user_id', user.id).eq('library_id', libraryId).eq('status', 'rejected')

  const { data: inserted, error: insertErr } = await supabase
    .from('staff_requests')
    .insert({
      user_id:    user.id,
      library_id: libraryId,
      status:     'pending',
      message:    message?.trim() ?? null,
      created_at: nowIST(),   // store IST for consistency with rest of codebase
    } as never)
    .select('id')
    .single()

  if (insertErr || !inserted) {
    logError('submitStaffRequest', 'Insert failed', insertErr)
    return { success: false, error: insertErr?.message ?? 'Failed to submit request' }
  }

  log('submitStaffRequest', `request=${inserted.id} user=${user.id} library=${libraryId}`)
  revalidatePath('/staff')
  return { success: true, data: { requestId: inserted.id } }
}

/** Cancel a pending request (staff-initiated). */
export async function cancelStaffRequest(requestId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: req } = await supabase
    .from('staff_requests').select('id, user_id, status').eq('id', requestId).maybeSingle()

  if (!req)                    return { success: false, error: 'Request not found' }
  if (req.user_id !== user.id) return { success: false, error: 'Access denied' }
  if (req.status !== 'pending') return { success: false, error: 'Only pending requests can be cancelled' }

  const { error } = await supabase.from('staff_requests').delete().eq('id', requestId)
  if (error) { logError('cancelStaffRequest', 'Delete failed', error); return { success: false, error: error.message } }

  log('cancelStaffRequest', `request=${requestId} cancelled by user=${user.id}`)
  revalidatePath('/staff')
  return { success: true, data: undefined }
}

/** Search active libraries by name / city / area for the request form. */
export async function searchLibraries(query: string): Promise<LibrarySearchResult[]> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const q = query.trim()
  if (q.length < 2) return []

  const { data, error } = await supabase
    .from('libraries')
    .select('id, name, area, city')
    .eq('is_active', true)
    .or(`name.ilike.%${q}%,city.ilike.%${q}%,area.ilike.%${q}%`)
    .limit(10)

  if (error || !data) return []
  return data.map(l => ({ id: l.id, name: l.name ?? '', area: l.area ?? '', city: l.city ?? '' }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD STATS
═══════════════════════════════════════════════════════════════════════════ */

export async function getStaffDashboardStats(libraryId: string): Promise<StaffDashboardStats> {
  const supabase = await createServerSupabaseClient()
  const now = nowIST()
  const { start, end } = todayRangeIST()

  const [todayBkRes, liveOccRes, seatsRes] = await Promise.all([
    supabase.from('bookings').select('id, status').eq('library_id', libraryId).gte('start_time', start).lte('start_time', end),
    supabase.from('bookings').select('id, status').eq('library_id', libraryId).lte('start_time', now).gte('end_time', now).in('status', ['confirmed', 'checked_in', 'held'] as never[]),
    supabase.from('seats').select('id, is_active').eq('library_id', libraryId),
  ])

  const todayBookings = todayBkRes.data ?? []
  const liveOcc       = liveOccRes.data ?? []
  const seats         = seatsRes.data ?? []

  return {
    todayBookings:     todayBookings.length,
    checkedIn:         todayBookings.filter(b => b.status === 'checked_in').length,
    pendingCheckIns:   liveOcc.filter(b => b.status === 'confirmed').length,
    currentlyOccupied: liveOcc.filter(b => ['confirmed', 'checked_in'].includes(b.status as string)).length,
    totalActiveSeats:  seats.filter(s => s.is_active).length,
    heldSeats:         liveOcc.filter(b => b.status === 'held').length,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TODAY'S BOOKINGS
═══════════════════════════════════════════════════════════════════════════ */

export async function getStaffTodayBookings(libraryId: string): Promise<StaffBooking[]> {
  const supabase = await createServerSupabaseClient()
  const { start, end } = todayRangeIST()

  const { data, error } = await supabase
    .from('bookings')
    .select('id, start_time, end_time, status, booking_mode, guest_name, guest_phone, user_id, seats(row_label, column_number), users(full_name, phone)')
    .eq('library_id', libraryId)
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: true })

  if (error || !data) return []

  const memberUserIds = data.filter((b: any) => b.user_id && b.users).map((b: any) => b.user_id as string)
  const planByUser: Record<string, string> = {}

  if (memberUserIds.length > 0) {
    const { data: subs } = await supabase
      .from('subscriptions').select('user_id, plans(name)')
      .in('user_id', memberUserIds).eq('status', 'active' as never).limit(memberUserIds.length * 2)
    for (const s of subs ?? []) {
      const sub = s as any
      if (sub.user_id && sub.plans?.name && !planByUser[sub.user_id])
        planByUser[sub.user_id] = sub.plans.name
    }
  }

  return data.map((b: any) => {
    const isGuest  = !b.user_id || !b.users
    const name     = isGuest ? (b.guest_name ?? 'Walk-in') : (b.users?.full_name ?? 'Unknown')
    const rawPhone = isGuest ? b.guest_phone : b.users?.phone
    const phone    = rawPhone
      ? String(rawPhone).replace(/^(\+?91)?(\d{2})(\d{4})(\d{4})$/, '+91 $2•••• $4')
      : null
    return {
      id: b.id,
      seatLabel:   b.seats ? `${b.seats.row_label}${b.seats.column_number}` : '?',
      studentName: name,
      phone,
      startTime:   b.start_time,
      endTime:     b.end_time,
      status:      b.status,
      bookingMode: b.booking_mode ?? 'offline',
      plan:        isGuest ? 'Walk-in' : (planByUser[b.user_id] ?? 'Per session'),
    }
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK-IN
═══════════════════════════════════════════════════════════════════════════ */

export async function staffCheckIn(bookingId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: staffRow } = await supabase.from('staff').select('library_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!staffRow) return { success: false, error: 'Staff record not found' }

  const { data: booking } = await supabase.from('bookings').select('id, library_id, status').eq('id', bookingId).maybeSingle()
  if (!booking) return { success: false, error: 'Booking not found' }
  if (booking.library_id !== staffRow.library_id) return { success: false, error: 'Access denied' }
  if (!['confirmed', 'held'].includes(booking.status as string))
    return { success: false, error: `Cannot check in — status is ${booking.status}` }

  const { error } = await supabase.from('bookings').update({ status: 'checked_in' as never }).eq('id', bookingId)
  if (error) { logError('staffCheckIn', 'Update failed', error); return { success: false, error: error.message } }

  log('staffCheckIn', `booking=${bookingId} by staff=${user.id}`)
  revalidatePath('/staff')
  revalidatePath('/staff/bookings')
  return { success: true, data: undefined }
}

export async function lookupBookingForScan(bookingId: string): Promise<ActionResult<{
  id: string; seatLabel: string; studentName: string
  startTime: string; endTime: string; status: string
}>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: staffRow } = await supabase.from('staff').select('library_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!staffRow) return { success: false, error: 'Staff record not found' }

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, start_time, end_time, status, library_id, guest_name, user_id, seats(row_label, column_number), users(full_name)')
    .eq('id', bookingId)
    .maybeSingle()

  if (error || !booking) return { success: false, error: 'Booking not found' }
  if (booking.library_id !== staffRow.library_id) return { success: false, error: 'Booking belongs to a different library' }

  const b         = booking as any
  const isGuest   = !b.user_id || !b.users
  const name      = isGuest ? (b.guest_name ?? 'Walk-in') : (b.users?.full_name ?? 'Unknown')
  const seatLabel = b.seats ? `${b.seats.row_label}${b.seats.column_number}` : '?'

  return {
    success: true,
    data: { id: b.id, seatLabel, studentName: name, startTime: b.start_time, endTime: b.end_time, status: b.status },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEAT LAYOUT (walk-in desk)
═══════════════════════════════════════════════════════════════════════════ */

export async function getStaffSeatLayout(libraryId: string): Promise<StaffSeatRow[]> {
  const supabase = await createServerSupabaseClient()
  const now = nowIST()

  const [seatsRes, bookingsRes] = await Promise.all([
    supabase.from('seats').select('id, row_label, column_number, is_active')
      .eq('library_id', libraryId).order('row_label').order('column_number'),
    supabase.from('bookings')
      .select('id, seat_id, status, start_time, end_time, guest_name, guest_phone, user_id, users(full_name, phone)')
      .eq('library_id', libraryId).lte('start_time', now).gte('end_time', now)
      .in('status', ['confirmed', 'checked_in', 'held'] as never[]),
  ])

  if (!seatsRes.data?.length) return []

  const bookingBySeat = new Map<string, any>()
  for (const b of bookingsRes.data ?? []) {
    if (!bookingBySeat.has(b.seat_id)) bookingBySeat.set(b.seat_id, b)
  }

  return seatsRes.data.map(s => {
    const b = bookingBySeat.get(s.id)
    const liveStatus: StaffSeatRow['liveStatus'] = !s.is_active ? 'inactive' : !b ? 'free'
      : ['confirmed', 'checked_in'].includes(b.status) ? 'booked' : 'held'
    const currentBooking = b ? {
      id:        b.id,
      guestName: b.user_id ? (b.users?.full_name ?? null) : (b.guest_name ?? null),
      phone:     b.user_id ? (b.users?.phone    ?? null) : (b.guest_phone ?? null),
      startTime: b.start_time, endTime: b.end_time, status: b.status,
    } : undefined
    return {
      id: s.id, rowLabel: s.row_label ?? '', colNumber: s.column_number ?? 0,
      isActive: s.is_active ?? false, liveStatus, currentBooking,
    }
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   WALK-IN BOOKING
═══════════════════════════════════════════════════════════════════════════ */

export async function staffWalkIn(input: StaffWalkInInput): Promise<ActionResult<{ bookingId: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: staffRow } = await supabase.from('staff').select('library_id')
    .eq('user_id', user.id).eq('library_id', input.libraryId).maybeSingle()
  if (!staffRow) return { success: false, error: 'Access denied — not assigned to this library' }

  const { seatId, libraryId, guestName, guestPhone, startTime, endTime, amountPaid, paymentMode } = input
  const rangeCheck = validateISTRange(startTime, endTime, 24)
  if (rangeCheck.ok === false) return { success: false, error: rangeCheck.error }

  const { data: seat } = await supabase.from('seats').select('id, is_active, library_id').eq('id', seatId).maybeSingle()
  if (!seat || seat.library_id !== libraryId) return { success: false, error: 'Seat not found' }
  if (!seat.is_active)                        return { success: false, error: 'Seat is inactive' }

  const { data: overlap } = await supabase.from('bookings').select('id').eq('seat_id', seatId)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[]).lt('start_time', endTime).gt('end_time', startTime)
  if (overlap && overlap.length > 0) return { success: false, error: 'Seat already booked in this time slot' }

  const { data: booking, error: bookErr } = await supabase.from('bookings')
    .insert({
      user_id: null, library_id: libraryId, seat_id: seatId,
      start_time: startTime, end_time: endTime,
      status: 'confirmed' as never, booking_mode: 'offline',
      guest_name: guestName.trim(), guest_phone: guestPhone.trim(),
    } as never)
    .select('id').single()

  if (bookErr || !booking) {
    logError('staffWalkIn', 'Insert failed', bookErr)
    return { success: false, error: bookErr?.message ?? 'Failed to create booking' }
  }

  if (amountPaid > 0) {
    const { error: payErr } = await supabase.from('payments')
      .insert({ user_id: null, booking_id: booking.id, amount: amountPaid, status: 'paid' as never } as never)
    if (payErr) logError('staffWalkIn', `Payment insert failed booking=${booking.id}`, payErr)
  }

  log('staffWalkIn', `booking=${booking.id} seat=${seatId} guest=${guestName} pay=${paymentMode} amount=${amountPaid}`)
  revalidatePath('/staff')
  revalidatePath('/staff/walk-in')
  revalidatePath('/staff/bookings')
  return { success: true, data: { bookingId: booking.id } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOK ISSUANCE
═══════════════════════════════════════════════════════════════════════════ */

export async function getLibraryBooks(libraryId: string): Promise<LibraryBook[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('book_copies')
    .select('id, status, books(id, title, author, isbn)')
    .eq('books.library_id' as never, libraryId).order('status')
  if (error || !data) return []
  return data.filter((c: any) => c.books).map((c: any) => ({
    copyId: c.id, bookId: c.books.id, title: c.books.title ?? 'Unknown',
    author: c.books.author ?? null, isbn: c.books.isbn ?? null, status: c.status ?? 'available',
  }))
}

export async function getActiveIssues(libraryId: string): Promise<ActiveIssue[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('book_issues')
    .select('id, issued_at, due_date, returned_at, user_id, book_copies(id, books(title, author, library_id)), users(full_name)')
    .is('returned_at', null).order('issued_at', { ascending: false })
  if (error || !data) return []
  return data
    .filter((i: any) => i.book_copies?.books?.library_id === libraryId)
    .map((i: any) => ({
      issueId: i.id, title: i.book_copies?.books?.title ?? 'Unknown',
      author: i.book_copies?.books?.author ?? null,
      issuedTo: i.users?.full_name ?? 'Guest', issuedAt: i.issued_at ?? '', dueDate: i.due_date ?? null,
    }))
}

export async function issueBookToGuest(
  copyId: string, guestName: string, dueDate: string,
): Promise<ActionResult<{ issueId: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  const { data: copy } = await supabase.from('book_copies').select('id, status').eq('id', copyId).maybeSingle()
  if (!copy)                     return { success: false, error: 'Book copy not found' }
  if (copy.status !== 'available') return { success: false, error: `Book is not available (${copy.status})` }
  const { data: issue, error: issueErr } = await supabase.from('book_issues')
    .insert({ copy_id: copyId, user_id: null, issued_at: nowIST(), due_date: dueDate } as never).select('id').single()
  if (issueErr || !issue) { logError('issueBookToGuest', 'Insert failed', issueErr); return { success: false, error: issueErr?.message ?? 'Failed to issue book' } }
  await supabase.from('book_copies').update({ status: 'issued' as never }).eq('id', copyId)
  log('issueBookToGuest', `issue=${issue.id} copy=${copyId} guest=${guestName}`)
  revalidatePath('/staff/books')
  return { success: true, data: { issueId: issue.id } }
}

export async function returnBook(issueId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  const { data: issue } = await supabase.from('book_issues').select('id, copy_id, returned_at').eq('id', issueId).maybeSingle()
  if (!issue)              return { success: false, error: 'Issue record not found' }
  if (issue.returned_at)   return { success: false, error: 'Book already returned' }
  const { error } = await supabase.from('book_issues').update({ returned_at: nowIST() } as never).eq('id', issueId)
  if (error) { logError('returnBook', 'Update failed', error); return { success: false, error: error.message } }
  await supabase.from('book_copies').update({ status: 'available' as never }).eq('id', issue.copy_id)
  log('returnBook', `issue=${issueId} returned`)
  revalidatePath('/staff/books')
  return { success: true, data: undefined }
}