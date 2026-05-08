'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, getSupabaseUser } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/actions/auth'
import { z } from 'zod'
import { log, logError, logWarn, timed } from '@/lib/logger'
import {
  nowIST,
  todayRangeIST,
  yesterdayRangeIST,
  monthRangeIST,
  pastMonthsStartIST,
  getISTHour,
  validateISTRange,
} from '@/lib/ist'

/* ═══════════════════════════════════════════════════════════════════════════
   TIMEZONE STRATEGY
   ─────────────────────────────────────────────────────────────────────────
   All users are in India (IST = Asia/Kolkata, UTC+5:30).
   DB column type: timestamp WITHOUT time zone.
   Convention:     store and compare plain IST wall-clock strings.
                   No UTC, no 'Z' suffix, no offset conversion anywhere.

   See lib/ist.ts for all timezone helpers.
═══════════════════════════════════════════════════════════════════════════ */

/* ─── In-memory group-by helper ───────────────────────────────────────────── */
function groupBy<T extends Record<string, unknown>>(
  arr: T[],
  key: keyof T,
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of arr) {
    const k = String(item[key])
    ;(out[k] ??= []).push(item)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   OWNER LIBRARIES
═══════════════════════════════════════════════════════════════════════════ */
export type OwnerLibrary = {
  id: string
  name: string
  city: string
  area: string
  is_active: boolean
  cover_url: string | null
  total_seats: number
  active_seats: number
  member_count: number
  staff_count: number
  month_revenue: number
}

export async function getOwnerLibraries(): Promise<OwnerLibrary[]> {
  return timed('getOwnerLibraries', 'fetch all libraries + stats', async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return []

    const { data: libs, error: libErr } = await supabase
      .from('libraries')
      .select('id, name, city, area, is_active')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })

    if (libErr) { logError('getOwnerLibraries', 'Failed to fetch libraries', libErr); return [] }
    if (!libs?.length) return []

    const libIds = libs.map((l) => l.id)
    const { start: mStart, end: mEnd } = monthRangeIST()

    const [seatsRes, staffRes, coversRes, planLibsRes, bookingsRes] = await Promise.all([
      supabase.from('seats').select('library_id, is_active').in('library_id', libIds),
      supabase.from('staff').select('library_id').in('library_id', libIds),
      supabase.from('library_images').select('library_id, image_url').in('library_id', libIds).eq('is_cover', true),
      supabase.from('plan_libraries').select('library_id, plan_id').in('library_id', libIds),
      supabase.from('bookings').select('id, library_id').in('library_id', libIds).gte('start_time', mStart).lte('start_time', mEnd),
    ])

    const allPlanIds    = [...new Set(planLibsRes.data?.map((r) => r.plan_id) ?? [])]
    const allBookingIds = bookingsRes.data?.map((b) => b.id) ?? []

    const [subsRes, paymentsRes] = await Promise.all([
      allPlanIds.length
        ? supabase.from('subscriptions').select('plan_id').eq('status', 'active' as never).in('plan_id', allPlanIds)
        : Promise.resolve({ data: [] as { plan_id: string }[] }),
      allBookingIds.length
        ? supabase.from('payments').select('booking_id, amount').eq('status', 'paid' as never).in('booking_id', allBookingIds)
        : Promise.resolve({ data: [] as { booking_id: string; amount: number }[] }),
    ])

    const seatsByLib    = groupBy(seatsRes.data ?? [], 'library_id')
    const staffByLib    = groupBy(staffRes.data ?? [], 'library_id')
    const plansByLib    = groupBy(planLibsRes.data ?? [], 'library_id')
    const bookingsByLib = groupBy(bookingsRes.data ?? [], 'library_id')

    const coverByLib: Record<string, string> = {}
    for (const r of coversRes.data ?? []) {
      if (!coverByLib[r.library_id]) coverByLib[r.library_id] = r.image_url
    }
    const subsByPlan: Record<string, number> = {}
    for (const s of subsRes.data ?? []) {
      subsByPlan[s.plan_id] = (subsByPlan[s.plan_id] ?? 0) + 1
    }
    const payByBooking: Record<string, number> = {}
    for (const p of paymentsRes.data ?? []) {
      payByBooking[p.booking_id] = Number(p.amount ?? 0)
    }

    return libs.map((lib) => {
      const seats      = seatsByLib[lib.id] ?? []
      const planIds    = (plansByLib[lib.id] ?? []).map((p) => p.plan_id)
      const bookingIds = (bookingsByLib[lib.id] ?? []).map((b) => b.id)
      return {
        id:            lib.id,
        name:          lib.name,
        city:          lib.city ?? '',
        area:          lib.area ?? '',
        is_active:     lib.is_active ?? false,
        cover_url:     coverByLib[lib.id] ?? null,
        total_seats:   seats.length,
        active_seats:  seats.filter((s) => s.is_active).length,
        member_count:  planIds.reduce((sum, pid) => sum + (subsByPlan[pid] ?? 0), 0),
        staff_count:   (staffByLib[lib.id] ?? []).length,
        month_revenue: bookingIds.reduce((sum, bid) => sum + (payByBooking[bid] ?? 0), 0),
      }
    })
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD STATS
═══════════════════════════════════════════════════════════════════════════ */
export type DashboardStats = {
  today_revenue: number
  yesterday_revenue: number
  today_bookings: number
  yesterday_bookings: number
  occupancy_pct: number
  occupied_seats: number
  total_active_seats: number
  held_seats: number
  total_members: number
  new_members_month: number
}

export async function getDashboardStats(libraryId: string): Promise<DashboardStats | null> {
  return timed('getDashboardStats', `library=${libraryId}`, async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return null

    const now       = nowIST()
    const today     = todayRangeIST()
    const yesterday = yesterdayRangeIST()
    const { start: mStart } = monthRangeIST()

    const [todayBkRes, ystBkRes, liveOccRes, seatsRes, planIdsRes] = await Promise.all([
      supabase.from('bookings').select('id, status').eq('library_id', libraryId)
        .gte('start_time', today.start).lte('start_time', today.end),
      supabase.from('bookings').select('id').eq('library_id', libraryId)
        .gte('start_time', yesterday.start).lte('start_time', yesterday.end),
      // Live occupancy: bookings whose window contains right now
      supabase.from('bookings').select('id, status').eq('library_id', libraryId)
        .lte('start_time', now).gte('end_time', now)
        .in('status', ['confirmed', 'checked_in', 'held'] as never[]),
      supabase.from('seats').select('id, is_active').eq('library_id', libraryId),
      supabase.from('plan_libraries').select('plan_id').eq('library_id', libraryId),
    ])

    const todayBkIds = todayBkRes.data?.map((b) => b.id) ?? []
    const ystBkIds   = ystBkRes.data?.map((b) => b.id)   ?? []
    const planIds    = planIdsRes.data?.map((r) => r.plan_id) ?? []

    const [todayRevRes, ystRevRes, totalMemRes, newMemRes] = await Promise.all([
      todayBkIds.length
        ? supabase.from('payments').select('amount').eq('status', 'paid' as never).in('booking_id', todayBkIds)
        : Promise.resolve({ data: [] as { amount: number }[] }),
      ystBkIds.length
        ? supabase.from('payments').select('amount').eq('status', 'paid' as never).in('booking_id', ystBkIds)
        : Promise.resolve({ data: [] as { amount: number }[] }),
      planIds.length
        ? supabase.from('subscriptions').select('id', { count: 'exact', head: true })
            .in('plan_id', planIds).eq('status', 'active' as never)
        : Promise.resolve({ count: 0 }),
      planIds.length
        ? supabase.from('subscriptions').select('id', { count: 'exact', head: true })
            .in('plan_id', planIds).gte('created_at', mStart)
        : Promise.resolve({ count: 0 }),
    ])

    const seats       = seatsRes.data ?? []
    const liveOcc     = liveOccRes.data ?? []
    const totalActive = seats.filter((s) => s.is_active).length
    const occupied    = liveOcc.filter((b) => ['confirmed', 'checked_in'].includes(b.status as string)).length
    const held        = liveOcc.filter((b) => b.status === 'held').length
    const sumAmt      = (rows: { amount: number }[] | null) =>
      rows?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0

    return {
      today_revenue:      sumAmt(todayRevRes.data),
      yesterday_revenue:  sumAmt(ystRevRes.data),
      today_bookings:     todayBkRes.data?.length ?? 0,
      yesterday_bookings: ystBkRes.data?.length ?? 0,
      occupancy_pct:      totalActive ? Math.round((occupied / totalActive) * 100) : 0,
      occupied_seats:     occupied,
      total_active_seats: totalActive,
      held_seats:         held,
      total_members:      (totalMemRes as { count: number }).count ?? 0,
      new_members_month:  (newMemRes  as { count: number }).count ?? 0,
    }
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTHLY REVENUE
═══════════════════════════════════════════════════════════════════════════ */
export type MonthRevPoint = { month: string; amount: number }

export async function getMonthlyRevenue(libraryId: string): Promise<MonthRevPoint[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const since = pastMonthsStartIST(6)

  const { data, error } = await supabase.rpc('monthly_revenue', {
    p_library_id: libraryId,
    p_since:      since,
  })

  if (error) { logError('getMonthlyRevenue', 'RPC failed', error); return [] }
  return (data ?? []) as MonthRevPoint[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   TODAY'S BOOKINGS TABLE
═══════════════════════════════════════════════════════════════════════════ */
export type TodayBooking = {
  id: string
  seat_label: string
  student: string
  phone: string | null
  plan: string | null
  start_time: string  // plain IST string — use fmtISTTime() on client for display
  end_time: string    // plain IST string — use fmtISTTime() on client for display
  status: string
  booking_mode: 'online' | 'offline'
}

export async function getTodayBookings(libraryId: string): Promise<TodayBooking[]> {
  return timed('getTodayBookings', `library=${libraryId}`, async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return []

    const { start, end } = todayRangeIST()

    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id, start_time, end_time, status, booking_mode,
        guest_name, guest_phone, user_id,
        seats(row_label, column_number),
        users(full_name, phone)
      `)
      .eq('library_id', libraryId)
      .gte('start_time', start)
      .lte('start_time', end)
      .order('start_time', { ascending: true })

    if (error) { logError('getTodayBookings', 'Query failed', error); return [] }
    if (!data?.length) return []

    const memberUserIds = data
      .filter((b: any) => b.user_id && b.users)
      .map((b: any) => b.user_id as string)

    const planByUser: Record<string, string> = {}
    if (memberUserIds.length > 0) {
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('user_id, plans(name)')
        .in('user_id', memberUserIds)
        .eq('status', 'active' as never)
        .limit(memberUserIds.length * 2)
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
      // Mask middle digits: +91 XX•••• XXXX
      const phone    = rawPhone
        ? String(rawPhone).replace(/^(\+?91)?(\d{2})(\d{4})(\d{4})$/, '+91 $2•••• $4')
        : null

      return {
        id:           b.id,
        seat_label:   b.seats ? `${b.seats.row_label}${b.seats.column_number}` : '?',
        student:      name,
        phone,
        plan:         isGuest ? 'Walk-in' : (planByUser[b.user_id] ?? 'Per session'),
        start_time:   b.start_time,
        end_time:     b.end_time,
        status:       b.status,
        booking_mode: b.booking_mode ?? 'offline',
      }
    })
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   SLOT HEATMAP
═══════════════════════════════════════════════════════════════════════════ */
export type SlotBand = {
  label: string
  start_h: number
  end_h: number
  pct: number
  count: number
}

export async function getSlotHeatmap(libraryId: string): Promise<SlotBand[]> {
  return timed('getSlotHeatmap', `library=${libraryId}`, async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return []

    const since = pastMonthsStartIST(1)  // last ~30 days

    const { data, error } = await supabase
      .from('bookings')
      .select('start_time')
      .eq('library_id', libraryId)
      .gte('start_time', since)
      .in('status', ['confirmed', 'checked_in', 'completed'] as never[])

    if (error) { logError('getSlotHeatmap', 'Query failed', error); return [] }

    const bands = [
      { label: '6–9 AM',   start_h: 6,  end_h: 9  },
      { label: '9 AM–12',  start_h: 9,  end_h: 12 },
      { label: '12–3 PM',  start_h: 12, end_h: 15 },
      { label: '3–6 PM',   start_h: 15, end_h: 18 },
      { label: '6–9 PM',   start_h: 18, end_h: 21 },
      { label: '9–10 PM',  start_h: 21, end_h: 22 },
    ]

    const counts = bands.map((b) => ({
      ...b,
      count: data?.filter((bk) => {
        const h = getISTHour(bk.start_time)  // DB string is already IST — just read the hour
        return h >= b.start_h && h < b.end_h
      }).length ?? 0,
    }))

    const max = Math.max(...counts.map((c) => c.count), 1)
    return counts.map((c) => ({ ...c, pct: Math.round((c.count / max) * 100) }))
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK-IN
═══════════════════════════════════════════════════════════════════════════ */
export async function checkInBooking(bookingId: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, library_id, libraries(owner_id)')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchErr) { logError('checkInBooking', 'Fetch failed', fetchErr); return { success: false, error: fetchErr.message } }

  const ownerRaw = booking?.libraries
  const ownerId  = Array.isArray(ownerRaw) ? ownerRaw[0]?.owner_id : (ownerRaw as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase
    .from('bookings').update({ status: 'checked_in' as never }).eq('id', bookingId)

  if (error) { logError('checkInBooking', 'Update failed', error); return { success: false, error: error.message } }

  log('checkInBooking', `booking=${bookingId} checked in`)
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/bookings')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEAT MANAGER
   ─────────────────────────────────────────────────────────────────────────
   live_status is computed server-side by comparing booking windows to nowIST().
   Both stored values and nowIST() are plain IST strings → correct comparison.
═══════════════════════════════════════════════════════════════════════════ */
export type ActiveBooking = {
  id:           string
  guest_name:   string | null   // null for members
  guest_phone:  string | null
  start_time:   string          // plain IST string — use fmtIST() on client
  end_time:     string          // plain IST string — use fmtIST() on client
  booking_mode: 'online' | 'offline'
  status:       string
}

export type SeatRow = {
  id:              string
  row_label:       string
  column_number:   number
  is_active:       boolean
  live_status:     'free' | 'booked' | 'held' | 'inactive'
  current_booking?: ActiveBooking  // present when live_status is 'booked' or 'held'
}

export async function getSeatLayout(libraryId: string): Promise<SeatRow[]> {
  return timed('getSeatLayout', `library=${libraryId}`, async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return []

    const now = nowIST()  // plain IST string — compare directly with DB values

    const [seatsRes, bookingsRes] = await Promise.all([
      supabase
        .from('seats')
        .select('id, row_label, column_number, is_active')
        .eq('library_id', libraryId)
        .order('row_label')
        .order('column_number'),

      // Active bookings: window contains right now (both sides are plain IST)
      supabase
        .from('bookings')
        .select(`
          id, seat_id, status, booking_mode,
          start_time, end_time,
          guest_name, guest_phone, user_id,
          users(full_name, phone)
        `)
        .eq('library_id', libraryId)
        .lte('start_time', now)
        .gte('end_time', now)
        .in('status', ['confirmed', 'checked_in', 'held'] as never[]),
    ])

    if (!seatsRes.data?.length) return []

    // seat_id → first active booking (a seat can't legitimately have >1)
    const bookingBySeat = new Map<string, any>()
    for (const b of bookingsRes.data ?? []) {
      if (!bookingBySeat.has(b.seat_id)) bookingBySeat.set(b.seat_id, b)
    }

    return seatsRes.data.map((s) => {
      const b = bookingBySeat.get(s.id)

      const live_status: SeatRow['live_status'] = !s.is_active
        ? 'inactive'
        : !b
          ? 'free'
          : ['confirmed', 'checked_in'].includes(b.status)
            ? 'booked'
            : 'held'

      const current_booking: ActiveBooking | undefined = b
        ? {
            id:           b.id,
            guest_name:   b.user_id ? (b.users?.full_name ?? null) : (b.guest_name ?? null),
            guest_phone:  b.user_id ? (b.users?.phone    ?? null) : (b.guest_phone ?? null),
            start_time:   b.start_time,
            end_time:     b.end_time,
            booking_mode: b.booking_mode ?? 'offline',
            status:       b.status,
          }
        : undefined

      return {
        id: s.id, row_label: s.row_label, column_number: s.column_number,
        is_active: s.is_active, live_status, current_booking,
      }
    })
  })
}

export async function toggleSeatActive(
  seatId:    string,
  libraryId: string,
  is_active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: seat, error: seatErr } = await supabase
    .from('seats').select('id, library_id, libraries(owner_id)').eq('id', seatId).maybeSingle()

  if (seatErr || !seat) return { success: false, error: 'Seat not found' }
  const ownerId = Array.isArray(seat.libraries)
    ? (seat.libraries[0] as any)?.owner_id
    : (seat.libraries as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase.from('seats').update({ is_active }).eq('id', seatId)
  if (error) { logError('toggleSeatActive', 'Update failed', error); return { success: false, error: error.message } }

  log('toggleSeatActive', `seat=${seatId} is_active=${is_active}`)
  revalidatePath('/dashboard/seat-manager')
  revalidatePath('/dashboard')
  return { success: true, data: undefined }
}

export async function addSeatRow(
  libraryId: string,
  rowLabel:  string,
  numSeats:  number,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const label = rowLabel.toUpperCase().trim()
  if (!/^[A-Z]$/.test(label)) return { success: false, error: 'Row label must be a single letter A–Z' }
  if (numSeats < 1 || numSeats > 50) return { success: false, error: 'Seats must be between 1 and 50' }

  const { data: existing } = await supabase
    .from('seats').select('id').eq('library_id', libraryId).eq('row_label', label).limit(1)
  if (existing?.length) return { success: false, error: `Row ${label} already exists` }

  const seats = Array.from({ length: numSeats }, (_, i) => ({
    library_id: libraryId, row_label: label, column_number: i + 1, is_active: true,
  }))

  const { error } = await supabase.from('seats').insert(seats)
  if (error) { logError('addSeatRow', 'Insert failed', error); return { success: false, error: error.message } }

  log('addSeatRow', `library=${libraryId} row=${label} seats=${numSeats}`)
  revalidatePath('/dashboard/seat-manager')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MANUAL WALK-IN BOOKING
═══════════════════════════════════════════════════════════════════════════ */
export type ManualBookInput = {
  seatId:      string
  libraryId:   string
  userName:    string
  userPhone:   string
  startTime:   string              // plain IST string — "YYYY-MM-DDTHH:mm:ss"
  endTime:     string              // plain IST string — "YYYY-MM-DDTHH:mm:ss"
  bookingMode: 'online' | 'offline'
  amountPaid:  number
  paymentMode: 'cash' | 'upi' | 'other'
  paymentNote: string
}

export async function manualBookSeat(
  input: ManualBookInput,
): Promise<ActionResult<{ bookingId: string }>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { seatId, libraryId, userName, userPhone, startTime, endTime, bookingMode, amountPaid, paymentMode, paymentNote } = input

  // Validate — use '+05:30' suffix so arithmetic is timezone-safe on the server
  if (!startTime || !endTime) return { success: false, error: 'Start and end time are required' }
  const rangeCheck = validateISTRange(startTime, endTime, 24)
  // if (!rangeCheck.ok) return { success: false, error: rangeCheck.error }

  // Ownership + seat validity in parallel
  const [libRes, seatRes] = await Promise.all([
    supabase.from('libraries').select('owner_id').eq('id', libraryId).maybeSingle(),
    supabase.from('seats').select('id, is_active, library_id').eq('id', seatId).maybeSingle(),
  ])

  if ((libRes.data as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }
  if (!seatRes.data || seatRes.data.library_id !== libraryId) return { success: false, error: 'Seat not found in this library' }
  if (!seatRes.data.is_active) return { success: false, error: 'Seat is inactive — activate it first' }

  // Overlap check: any active booking whose window overlaps [startTime, endTime)
  const { data: overlap } = await supabase
    .from('bookings')
    .select('id, start_time, end_time')
    .eq('seat_id', seatId)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])
    .lt('start_time', endTime)
    .gt('end_time', startTime)

  if (overlap && overlap.length > 0)
    return { success: false, error: 'Seat already has an active booking in this time slot' }

  const { data: booking, error: bookErr } = await supabase
    .from('bookings')
    .insert({
      user_id:      null,
      library_id:   libraryId,
      seat_id:      seatId,
      start_time:   startTime,
      end_time:     endTime,
      status:       'confirmed' as never,
      guest_name:   userName.trim(),
      guest_phone:  userPhone.trim(),
      booking_mode: bookingMode,
    } as never)
    .select('id')
    .single()

  if (bookErr || !booking) {
    logError('manualBookSeat', 'Insert failed', bookErr)
    return { success: false, error: bookErr?.message ?? 'Failed to create booking' }
  }

  if (amountPaid > 0) {
    const { error: payErr } = await supabase
      .from('payments')
      .insert({
        user_id:    null,
        booking_id: booking.id,
        amount:     amountPaid,
        status:     'paid' as never,
      } as never)

    if (payErr)
      logError('manualBookSeat', `Payment insert failed for booking=${booking.id}`, payErr)
  }

  log('manualBookSeat', `booking=${booking.id} seat=${seatId} guest=${userName} mode=${bookingMode} amount=${amountPaid} pay=${paymentMode} note="${paymentNote}"`)
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/seat-manager')
  return { success: true, data: { bookingId: booking.id } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXTEND BOOKING
═══════════════════════════════════════════════════════════════════════════ */
export async function extendBooking(
  bookingId:  string,
  libraryId:  string,
  newEndTime: string, // plain IST string
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, seat_id, start_time, end_time, status')
    .eq('id', bookingId)
    .eq('library_id', libraryId)
    .maybeSingle()

  if (fetchErr || !booking) return { success: false, error: 'Booking not found' }
  if (!['confirmed', 'checked_in'].includes(booking.status as string))
    return { success: false, error: 'Can only extend confirmed or checked-in bookings' }

  // Arithmetic uses '+05:30' so it's timezone-safe on the server
  const newEndMs     = new Date(newEndTime       + '+05:30').getTime()
  const currentEndMs = new Date(booking.end_time + '+05:30').getTime()
  const startMs      = new Date(booking.start_time + '+05:30').getTime()

  if (isNaN(newEndMs))          return { success: false, error: 'Invalid end time format' }
  if (newEndMs <= currentEndMs) return { success: false, error: 'New end time must be after current end time' }
  if (newEndMs - startMs > 24 * 3_600_000)
    return { success: false, error: 'Total booking duration cannot exceed 24 hours' }

  // Conflict check in the extended window [current_end, new_end)
  const { data: conflict } = await supabase
    .from('bookings')
    .select('id')
    .eq('seat_id', booking.seat_id)
    .neq('id', bookingId)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])
    .lt('start_time', newEndTime)
    .gt('end_time', booking.end_time)

  if (conflict && conflict.length > 0)
    return { success: false, error: 'Another booking conflicts with the extended slot' }

  const { error: updateErr } = await supabase
    .from('bookings').update({ end_time: newEndTime } as never).eq('id', bookingId)

  if (updateErr) { logError('extendBooking', 'Update failed', updateErr); return { success: false, error: updateErr.message } }

  log('extendBooking', `booking=${bookingId} extended to ${newEndTime}`)
  revalidatePath('/dashboard/seat-manager')
  revalidatePath('/dashboard')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORCE FREE SEAT
═══════════════════════════════════════════════════════════════════════════ */
export async function forceFreeSeat(
  seatId:    string,
  libraryId: string,
): Promise<ActionResult<{ cancelledBookingId: string }>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const now = nowIST()
  const { data: active } = await supabase
    .from('bookings')
    .select('id')
    .eq('seat_id', seatId)
    .eq('library_id', libraryId)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])
    .lte('start_time', now)
    .gte('end_time', now)
    .order('start_time', { ascending: false })
    .limit(1)

  if (!active?.length)
    return { success: false, error: 'No active booking found for this seat right now' }

  const bookingId = active[0].id
  const { error } = await supabase
    .from('bookings').update({ status: 'cancelled' as never }).eq('id', bookingId)

  if (error) { logError('forceFreeSeat', 'Update failed', error); return { success: false, error: error.message } }

  log('forceFreeSeat', `cancelled booking=${bookingId} seat=${seatId}`)
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/seat-manager')
  return { success: true, data: { cancelledBookingId: bookingId } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SLOT CONFIG (stored as JSONB in libraries.description)
═══════════════════════════════════════════════════════════════════════════ */
export type SlotConfig = {
  id:        string
  start:     string
  end:       string
  days:      string
  price:     number
  discount:  number
  is_active: boolean
}

async function getLibMeta(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  libraryId: string,
  userId:    string,
) {
  const { data: lib, error } = await supabase
    .from('libraries').select('owner_id, description').eq('id', libraryId).maybeSingle()
  if (error || !lib || (lib as any).owner_id !== userId) return null
  let meta: { slots?: SlotConfig[] } = {}
  try { meta = JSON.parse((lib as any).description ?? '{}') }
  catch { logWarn('getLibMeta', `Failed to parse description for library=${libraryId}`) }
  return meta
}

export async function getSlotConfigs(libraryId: string): Promise<SlotConfig[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []
  const meta = await getLibMeta(supabase, libraryId, user.id)
  return meta?.slots ?? []
}

export async function upsertSlotConfig(
  libraryId: string,
  slot: Omit<SlotConfig, 'id'> & { id?: string },
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  const meta = await getLibMeta(supabase, libraryId, user.id)
  if (!meta) return { success: false, error: 'Access denied' }
  const slots: SlotConfig[] = meta.slots ?? []
  if (slot.id) {
    const idx = slots.findIndex((s) => s.id === slot.id)
    if (idx >= 0) slots[idx] = { ...slot, id: slot.id }
    else slots.push({ ...slot, id: slot.id })
  } else {
    slots.push({ ...slot, id: crypto.randomUUID() })
  }
  const { error } = await supabase
    .from('libraries').update({ description: JSON.stringify({ ...meta, slots }) }).eq('id', libraryId)
  if (error) { logError('upsertSlotConfig', 'Update failed', error); return { success: false, error: error.message } }
  revalidatePath('/dashboard/slot-config')
  return { success: true, data: undefined }
}

export async function toggleSlotConfig(
  libraryId: string,
  slotId:    string,
  is_active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  const meta = await getLibMeta(supabase, libraryId, user.id)
  if (!meta) return { success: false, error: 'Access denied' }
  const slots: SlotConfig[] = meta.slots ?? []
  const slot = slots.find((s) => s.id === slotId)
  if (!slot) return { success: false, error: 'Slot not found' }
  slot.is_active = is_active
  const { error } = await supabase
    .from('libraries').update({ description: JSON.stringify({ ...meta, slots }) }).eq('id', libraryId)
  if (error) { logError('toggleSlotConfig', 'Update failed', error); return { success: false, error: error.message } }
  revalidatePath('/dashboard/slot-config')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAN BUILDER
═══════════════════════════════════════════════════════════════════════════ */
export type PlanWithStats = {
  id:               string
  name:             string
  price:            number
  duration_days:    number
  session_limit:    string | null
  scope:            string
  is_active:        boolean
  subscriber_count: number
  libraries:        { id: string; name: string }[]
}

export async function getOwnerPlans(ownerId?: string): Promise<PlanWithStats[]> {
  return timed('getOwnerPlans', 'fetch plans + subscriber counts', async () => {
    const { supabase, user } = await getSupabaseUser()
    const uid = ownerId ?? user?.id
    if (!uid) return []

    const { data: plans, error: planErr } = await supabase
      .from('plans')
      .select(`id, name, price, duration_days, session_limit, scope, plan_libraries(library_id, libraries(id, name))`)
      .eq('owner_id', uid)
      .order('created_at', { ascending: false })

    if (planErr) { logError('getOwnerPlans', 'Fetch failed', planErr); return [] }
    if (!plans?.length) return []

    const planIds = plans.map((p) => p.id)
    const { data: activeSubs } = await supabase
      .from('subscriptions').select('plan_id').in('plan_id', planIds).eq('status', 'active' as never)

    const subCountByPlan: Record<string, number> = {}
    for (const s of activeSubs ?? [])
      subCountByPlan[s.plan_id] = (subCountByPlan[s.plan_id] ?? 0) + 1

    return plans.map((p) => {
      const planLibs = (p as any).plan_libraries ?? []
      return {
        id:               p.id,
        name:             p.name ?? '',
        price:            Number(p.price ?? 0),
        duration_days:    p.duration_days ?? 30,
        session_limit:    p.session_limit ?? null,
        scope:            (p.scope as string) ?? 'library',
        is_active:        true,
        subscriber_count: subCountByPlan[p.id] ?? 0,
        libraries:        planLibs.map((pl: any) => ({ id: pl.libraries?.id ?? pl.library_id, name: pl.libraries?.name ?? '' })),
      }
    })
  })
}

const createPlanSchema = z.object({
  name:          z.string().min(2).max(80).trim(),
  price:         z.number().positive(),
  duration_days: z.number().int().positive(),
  session_limit: z.string().optional(),
  scope:         z.enum(['library', 'cross']),
  library_ids:   z.array(z.string().uuid()).min(1),
})
export type CreatePlanInput = z.infer<typeof createPlanSchema>

export async function createPlan(input: CreatePlanInput): Promise<ActionResult<{ planId: string }>> {
  const parsed = createPlanSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { name, price, duration_days, session_limit, scope, library_ids } = parsed.data
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .insert({ owner_id: user.id, name, price, duration_days, session_limit: session_limit ?? null, scope: scope as never })
    .select('id').single()

  if (planErr || !plan) { logError('createPlan', 'Insert failed', planErr); return { success: false, error: planErr?.message ?? 'Failed to create plan' } }

  const { error: linkErr } = await supabase
    .from('plan_libraries').insert(library_ids.map((lid) => ({ plan_id: plan.id, library_id: lid })))
  if (linkErr) { logError('createPlan', 'Link insert failed', linkErr); return { success: false, error: linkErr.message } }

  log('createPlan', `plan=${plan.id} name=${name}`)
  revalidatePath('/dashboard/plan-builder')
  return { success: true, data: { planId: plan.id } }
}

export async function archivePlan(planId: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: plan } = await supabase
    .from('plans').select('owner_id').eq('id', planId).maybeSingle()
  if ((plan as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  await Promise.all([
    supabase.from('plan_libraries').delete().eq('plan_id', planId),
    supabase.from('plans').delete().eq('id', planId),
  ])

  log('archivePlan', `plan=${planId}`)
  revalidatePath('/dashboard/plan-builder')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE LIBRARY ACTIVE
═══════════════════════════════════════════════════════════════════════════ */
export async function toggleLibraryActive(libraryId: string, is_active: boolean): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('libraries').update({ is_active }).eq('id', libraryId).eq('owner_id', user.id)

  if (error) { logError('toggleLibraryActive', 'Update failed', error); return { success: false, error: error.message } }

  log('toggleLibraryActive', `library=${libraryId} is_active=${is_active}`)
  revalidatePath('/dashboard/my-libraries')
  revalidatePath('/dashboard')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FIRST LIBRARY ID
═══════════════════════════════════════════════════════════════════════════ */
export async function getFirstLibraryId(): Promise<string | null> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return null
  const { data } = await supabase
    .from('libraries').select('id').eq('owner_id', user.id)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data as any)?.id ?? null
}