'use server'

import { cache } from 'react'                          // ← NEW: per-request dedup
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient, getSupabaseUser } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/actions/auth'
import { z } from 'zod'
import { log, logError, timed } from '@/lib/logger'
import {
  nowIST,
  todayRangeIST,
  yesterdayRangeIST,
  monthRangeIST,
  pastMonthsStartIST,
  getISTHour,
  validateISTRange,
} from '@/lib/ist'
import {
  fetchSlotConfigs,
  fetchActiveSlotConfigs,
  upsertSlotConfig as upsertSlotConfigDb,
  toggleSlotConfig as toggleSlotConfigDb,
  revalidateSlotConfigsCache,
} from '@/lib/booking/slotConfigService'
import { revalidateCitiesCache } from '@/lib/booking/citiesCache'
import { validateBooking } from '@/lib/booking/slotBoundaryValidation'
import { getLibraryBookingRevenue } from '@/lib/booking/revenue'
import type { SlotConfig, SlotConfigInput } from '@/lib/booking/types'

// Re-exported for backward compatibility — components import SlotConfig from
// '@/lib/actions/owner'. The type now lives in '@/lib/booking/types'.
export type { SlotConfig, SlotConfigInput }

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
  /** Booking-tied revenue (online + manual + walk-in), current calendar month */
  month_revenue: number
  /** Subscription-purchase revenue attributable to this library, current calendar month */
  month_subscription_revenue: number
  /** month_revenue + month_subscription_revenue — see lib/booking/revenue.ts */
  month_total_revenue: number
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

    const [subsRes, paymentsRes, subPaymentsRes] = await Promise.all([
      allPlanIds.length
        ? supabase.from('subscriptions').select('plan_id').eq('status', 'active' as never).in('plan_id', allPlanIds)
        : Promise.resolve({ data: [] as { plan_id: string }[] }),
      allBookingIds.length
        ? supabase.from('payments').select('booking_id, amount').eq('status', 'paid' as never).in('booking_id', allBookingIds)
        : Promise.resolve({ data: [] as { booking_id: string; amount: number }[] }),
      // Subscription-purchase payments for ALL of this owner's plans in ONE
      // query, instead of one query per library (see comment below). Mirrors
      // getSubscriptionRevenueForLibrary's own query in lib/booking/revenue.ts
      // exactly — same table, same filters, same join — just batched across
      // every plan at once rather than one plan-set per library.
      allPlanIds.length
        ? supabase
            .from('payments')
            .select('amount, subscriptions!inner(plan_id, created_at)')
            .eq('status', 'paid' as never)
            .is('booking_id', null)
            .in('subscriptions.plan_id', allPlanIds)
            .gte('created_at', mStart)
            .lte('created_at', mEnd)
        : Promise.resolve({ data: [] as { amount: number; subscriptions: { plan_id: string; created_at: string } }[] }),
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

    // Subscription revenue PER PLAN (not yet per library) — summed once here,
    // then attributed to each library below via plansByLib. This preserves
    // the exact semantic documented in getSubscriptionRevenueForLibrary: a
    // 'cross' scope plan linked to multiple libraries contributes its FULL
    // payment amount to EACH linked library (not divided), so summing
    // month_subscription_revenue across all of an owner's libraries can
    // double-count a single cross-library plan purchase — that's intentional,
    // matching the original per-library function's documented behavior.
    const subRevenueByPlan: Record<string, number> = {}
    for (const row of (subPaymentsRes.data ?? []) as any[]) {
      const planId = row.subscriptions?.plan_id
      if (!planId) continue
      subRevenueByPlan[planId] = (subRevenueByPlan[planId] ?? 0) + Number(row.amount ?? 0)
    }

    return libs.map((lib) => {
      const seats      = seatsByLib[lib.id] ?? []
      const planIds    = (plansByLib[lib.id] ?? []).map((p) => p.plan_id)
      const bookingIds = (bookingsByLib[lib.id] ?? []).map((b) => b.id)
      const monthRevenue = bookingIds.reduce((sum, bid) => sum + (payByBooking[bid] ?? 0), 0)
      // Sum the full subscription-payment amount for every plan linked to
      // this library — see the double-counting note above subRevenueByPlan.
      const monthSubRevenue = planIds.reduce((sum, pid) => sum + (subRevenueByPlan[pid] ?? 0), 0)
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
        month_revenue:               monthRevenue,
        month_subscription_revenue:  monthSubRevenue,
        month_total_revenue:         monthRevenue + monthSubRevenue,
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

    const [todayBkRes, ystBkRes, liveOccRes, seatsRes, planIdsRes, todayRev, ystRev] = await Promise.all([
      supabase.from('bookings').select('id, status').eq('library_id', libraryId)
        .gte('start_time', today.start).lte('start_time', today.end),
      supabase.from('bookings').select('id').eq('library_id', libraryId)
        .gte('start_time', yesterday.start).lte('start_time', yesterday.end),
      supabase.from('bookings').select('id, status').eq('library_id', libraryId)
        .lte('start_time', now).gte('end_time', now)
        .in('status', ['confirmed', 'checked_in', 'held'] as never[]),
      supabase.from('seats').select('id, is_active').eq('library_id', libraryId),
      supabase.from('plan_libraries').select('plan_id').eq('library_id', libraryId),
      // Centralized booking-revenue calculation (lib/booking/revenue.ts) —
      // same query shape used by getOwnerLibraries' month_revenue, so
      // "today's revenue" and "this month's revenue" are never computed two
      // different ways.
      getLibraryBookingRevenue(supabase, libraryId, today.start, today.end),
      getLibraryBookingRevenue(supabase, libraryId, yesterday.start, yesterday.end),
    ])

    const planIds = planIdsRes.data?.map((r) => r.plan_id) ?? []

    const [totalMemRes, newMemRes] = await Promise.all([
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

    return {
      today_revenue:      todayRev,
      yesterday_revenue:  ystRev,
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
  start_time: string
  end_time: string
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
   ─────────────────────────────────────────────────────────────────────────
   SLOT-ONLY ARCHITECTURE: buckets are now the library's ACTUAL configured
   slots (slot_configs), not hardcoded 3-hour display bands. A booking is
   counted in the slot whose [start,end) contains its start_time — the same
   containment rule used for pricing (lib/booking/pricing.ts) — so "slot
   popularity" on the dashboard matches the slots the owner actually
   configured (and their labels/prices), rather than an unrelated fixed grid.
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

    const since = pastMonthsStartIST(1)

    const [bookingsRes, slots] = await Promise.all([
      supabase
        .from('bookings')
        .select('start_time')
        .eq('library_id', libraryId)
        .gte('start_time', since)
        .in('status', ['confirmed', 'checked_in', 'completed'] as never[]),
      fetchActiveSlotConfigs(supabase, libraryId),
    ])

    if (bookingsRes.error) { logError('getSlotHeatmap', 'Query failed', bookingsRes.error); return [] }
    if (slots.length === 0) return []

    const data = bookingsRes.data ?? []

    const bands = [...slots]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((slot) => {
        const startH = parseInt(slot.start.split(':')[0] ?? '0', 10)
        const endH   = parseInt(slot.end.split(':')[0]   ?? '0', 10)
        return {
          label:   `${slot.start}–${slot.end}`,
          start_h: startH,
          end_h:   endH,
          count: data.filter((bk) => {
            const h = getISTHour(bk.start_time)
            // Same containment convention as the heatmap previously used —
            // hour-granularity bucketing into [start_h, end_h). Bookings
            // whose minute offset places them technically outside the slot
            // (e.g. a 09:00-09:30 slot vs a 09:45 booking start) won't occur
            // in practice since slotBoundaryValidation rejects such bookings
            // at creation time.
            return h >= startH && h < endH
          }).length,
        }
      })

    const max = Math.max(...bands.map((b) => b.count), 1)
    return bands.map((b) => ({ ...b, pct: Math.round((b.count / max) * 100) }))
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
═══════════════════════════════════════════════════════════════════════════ */
export type ActiveBooking = {
  id:           string
  guest_name:   string | null
  guest_phone:  string | null
  start_time:   string
  end_time:     string
  booking_mode: 'online' | 'offline'
  status:       string
}

export type SeatRow = {
  id:              string
  row_label:       string
  column_number:   number
  is_active:       boolean
  live_status:     'free' | 'booked' | 'held' | 'inactive'
  current_booking?: ActiveBooking
}

export async function getSeatLayout(libraryId: string): Promise<SeatRow[]> {
  return timed('getSeatLayout', `library=${libraryId}`, async () => {
    const { supabase, user } = await getSupabaseUser()
    if (!user) return []

    const now = nowIST()

    const [seatsRes, bookingsRes] = await Promise.all([
      supabase
        .from('seats')
        .select('id, row_label, column_number, is_active')
        .eq('library_id', libraryId)
        .order('row_label')
        .order('column_number'),
      supabase
        .from('bookings')
        .select(`
          id, seat_id, status, booking_mode,
          start_time, end_time, hold_expires_at,
          guest_name, guest_phone, user_id,
          users(full_name, phone)
        `)
        .eq('library_id', libraryId)
        .lte('start_time', now)
        .gte('end_time', now)
        .in('status', ['confirmed', 'checked_in', 'held'] as never[]),
    ])

    if (!seatsRes.data?.length) return []

    const nowMs = new Date(now).getTime()

    const bookingBySeat = new Map<string, any>()
    for (const b of bookingsRes.data ?? []) {
      // Option B: treat a held booking whose hold window has expired as if it
      // doesn't exist — the seat shows free immediately without needing a cron.
      // The DB EXCLUDE constraint still prevents any actual double-booking at
      // write time, so this is purely a UI accuracy fix.
      if (b.status === 'held' && b.hold_expires_at) {
        const expiresMs = new Date(b.hold_expires_at).getTime()
        if (expiresMs < nowMs) continue   // skip — treat as free
      }
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

export async function editSeatRow(
  libraryId: string,
  oldLabel:  string,
  newLabel:  string,
  newCount:  number,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const normalOld = oldLabel.toUpperCase().trim()
  const normalNew = newLabel.toUpperCase().trim()
  if (!/^[A-Z]$/.test(normalNew)) return { success: false, error: 'Row label must be a single letter A–Z' }
  if (newCount < 1 || newCount > 50) return { success: false, error: 'Seats must be between 1 and 50' }

  if (normalNew !== normalOld) {
    const { data: clash } = await supabase
      .from('seats').select('id').eq('library_id', libraryId).eq('row_label', normalNew).limit(1)
    if (clash?.length) return { success: false, error: `Row ${normalNew} already exists` }
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('seats')
    .select('id, column_number')
    .eq('library_id', libraryId)
    .eq('row_label', normalOld)
    .order('column_number')

  if (fetchErr || !existing) return { success: false, error: 'Could not fetch row seats' }

  // Rename first if needed
  if (normalNew !== normalOld) {
    const { error: renameErr } = await supabase
      .from('seats')
      .update({ row_label: normalNew })
      .eq('library_id', libraryId)
      .eq('row_label', normalOld)
    if (renameErr) { logError('editSeatRow', 'Rename failed', renameErr); return { success: false, error: renameErr.message } }
  }

  const currentCount = existing.length

  if (newCount > currentCount) {
    const toAdd = Array.from({ length: newCount - currentCount }, (_, i) => ({
      library_id:    libraryId,
      row_label:     normalNew,
      column_number: currentCount + i + 1,
      is_active:     true,
    }))
    const { error: insertErr } = await supabase.from('seats').insert(toAdd)
    if (insertErr) { logError('editSeatRow', 'Insert failed', insertErr); return { success: false, error: insertErr.message } }
  } else if (newCount < currentCount) {
    const toRemove = existing.slice(newCount).map((s) => s.id)
    if (toRemove.length) {
      const { error: deleteErr } = await supabase.from('seats').delete().in('id', toRemove)
      if (deleteErr) { logError('editSeatRow', 'Delete failed', deleteErr); return { success: false, error: deleteErr.message } }
    }
  }

  log('editSeatRow', `library=${libraryId} ${normalOld}→${normalNew} seats=${newCount}`)
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
  startTime:   string
  endTime:     string
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

  if (!startTime || !endTime) return { success: false, error: 'Start and end time are required' }
  const rangeCheck = validateISTRange(startTime, endTime, 24)
  if (rangeCheck.ok === false) {
    return { success: false, error: rangeCheck.error }
  }

  const [libRes, seatRes] = await Promise.all([
    supabase.from('libraries').select('owner_id').eq('id', libraryId).maybeSingle(),
    supabase.from('seats').select('id, is_active, library_id').eq('id', seatId).maybeSingle(),
  ])

  if ((libRes.data as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  // SLOT-ONLY ARCHITECTURE: the booking must fit entirely inside one active
  // slot — this is the same check used by student.initiateBooking and
  // staff.seniorManualBook (lib/booking/slotBoundaryValidation.ts). Owners
  // can still record a free-form `amountPaid` for walk-ins, but the BOOKING
  // WINDOW itself must be valid per slot_configs.
  const slots = await fetchActiveSlotConfigs(supabase, libraryId)
  const windowCheck = validateBooking({ slots, startTime, endTime, graceMinutes: 5 })
  if (windowCheck.ok === false) return { success: false, error: windowCheck.error }

  if (!seatRes.data || seatRes.data.library_id !== libraryId) return { success: false, error: 'Seat not found in this library' }
  if (!seatRes.data.is_active) return { success: false, error: 'Seat is inactive — activate it first' }

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
    // PostgreSQL error 23P01 = exclusion_violation, raised by the
    // no_overlapping_bookings EXCLUDE constraint. This is the hard backstop
    // against double-booking — it can fire here if a student's online
    // booking and an owner's walk-in booking for the same seat/time race
    // each other. Without this check the owner would see a raw Postgres
    // error message instead of a clear "already booked" message.
    if ((bookErr as any)?.code === '23P01') {
      logError('manualBookSeat', `Exclusion violation — seat ${seatId} booked concurrently`, bookErr)
      return { success: false, error: 'This seat was just booked by someone else. Please refresh and choose another seat.' }
    }
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
  // Staff views must also see the new booking
  revalidatePath('/staff/seat-manager')
  revalidatePath('/staff')
  return { success: true, data: { bookingId: booking.id } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXTEND BOOKING
═══════════════════════════════════════════════════════════════════════════ */
export async function extendBooking(
  bookingId:  string,
  libraryId:  string,
  newEndTime: string,
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

  const newEndMs     = new Date(newEndTime       + '+05:30').getTime()
  const currentEndMs = new Date(booking.end_time + '+05:30').getTime()
  const startMs      = new Date(booking.start_time + '+05:30').getTime()

  if (isNaN(newEndMs))          return { success: false, error: 'Invalid end time format' }
  if (newEndMs <= currentEndMs) return { success: false, error: 'New end time must be after current end time' }
  if (newEndMs - startMs > 24 * 3_600_000)
    return { success: false, error: 'Total booking duration cannot exceed 24 hours' }

  // SLOT-ONLY ARCHITECTURE: the extended [start, newEnd) range must still fit
  // entirely inside the same active slot that contained the original
  // booking — extending past a slot's end is the same as the slot-boundary
  // rejection at creation time (lib/booking/slotBoundaryValidation.ts).
  const slots = await fetchActiveSlotConfigs(supabase, libraryId)
  const windowCheck = validateBooking({
    slots,
    startTime: booking.start_time as string,
    endTime:   newEndTime,
  })
  if (windowCheck.ok === false) return { success: false, error: windowCheck.error }

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
  revalidatePath('/staff/seat-manager')
  revalidatePath('/staff')
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
  // Staff seat manager must also see the freed seat
  revalidatePath('/staff/seat-manager')
  revalidatePath('/staff')
  return { success: true, data: { cancelledBookingId: bookingId } }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SLOT CONFIG
   ─────────────────────────────────────────────────────────────────────────
   Slots live in the `slot_configs` table (see supabase/migrations).
   SlotConfig / SlotConfigInput types and all validation live in
   lib/booking/* — this file only adds the owner-specific ownership check
   before delegating to the shared service.
═══════════════════════════════════════════════════════════════════════════ */

/** Verifies the current user owns `libraryId`. Returns null if not. */
async function verifyLibraryOwner(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  libraryId: string,
  userId: string,
): Promise<true | null> {
  const { data: lib, error } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if (error || !lib || (lib as any).owner_id !== userId) return null
  return true
}

export async function getSlotConfigs(libraryId: string): Promise<SlotConfig[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []
  if (!(await verifyLibraryOwner(supabase, libraryId, user.id))) return []
  return fetchSlotConfigs(supabase, libraryId)
}

export async function upsertSlotConfig(
  libraryId: string,
  slot: SlotConfigInput,
): Promise<ActionResult<SlotConfig>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  if (!(await verifyLibraryOwner(supabase, libraryId, user.id)))
    return { success: false, error: 'Access denied' }

  const result = await upsertSlotConfigDb(supabase, libraryId, slot, user.id)
  if (result.success === false) return result

  log('upsertSlotConfig', `library=${libraryId} slot=${result.data.id}`)
  revalidateSlotConfigsCache(libraryId)
  revalidatePath('/dashboard/slot-config')
  revalidatePath('/dashboard/bookings')
  return result
}

export async function toggleSlotConfig(
  libraryId: string,
  slotId:    string,
  is_active: boolean,
): Promise<ActionResult<SlotConfig>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  if (!(await verifyLibraryOwner(supabase, libraryId, user.id)))
    return { success: false, error: 'Access denied' }

  const result = await toggleSlotConfigDb(supabase, libraryId, slotId, is_active)
  if (result.success === false) return result

  log('toggleSlotConfig', `library=${libraryId} slot=${slotId} is_active=${is_active}`)
  revalidateSlotConfigsCache(libraryId)
  revalidatePath('/dashboard/slot-config')
  revalidatePath('/dashboard/bookings')
  return result
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
  revalidateCitiesCache()
  revalidatePath('/dashboard/my-libraries')
  revalidatePath('/dashboard')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FIRST LIBRARY ID
   ─────────────────────────────────────────────────────────────────────────
   Wrapped in React cache() so that when layout.tsx and a page.tsx both call
   this within the same server render pass, only ONE DB query fires.
   The cache is per-request (not persistent) — React discards it after the
   render tree completes.
═══════════════════════════════════════════════════════════════════════════ */
export const getFirstLibraryId = cache(async (): Promise<string | null> => {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return null
  const { data } = await supabase
    .from('libraries').select('id').eq('owner_id', user.id)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data as any)?.id ?? null
})



/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY EDIT — INFO
   ─────────────────────────────────────────────────────────────────────────
   Append this entire block to the bottom of src/lib/actions/owner.ts
═══════════════════════════════════════════════════════════════════════════ */

export async function updateLibraryInfo(
  libraryId: string,
  patch: { name: string; city: string; area: string },
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Verify ownership
  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase
    .from('libraries')
    .update({ name: patch.name, city: patch.city, area: patch.area })
    .eq('id', libraryId)

  if (error) { logError('updateLibraryInfo', 'Update failed', error); return { success: false, error: error.message } }

  log('updateLibraryInfo', `library=${libraryId} name=${patch.name}`)
  revalidateCitiesCache()
  revalidatePath('/dashboard/my-libraries')
  revalidatePath('/dashboard')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY EDIT — AMENITIES
═══════════════════════════════════════════════════════════════════════════ */

/** Returns all amenities in the system + which ones are selected for this library */
export async function getAmenities(
  libraryId: string,
): Promise<{ all: { id: string; name: string }[]; selected: string[] }> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { all: [], selected: [] }

  const [allRes, selectedRes] = await Promise.all([
    supabase.from('amenities').select('id, name').order('name'),
    supabase.from('library_amenities').select('amenity_id').eq('library_id', libraryId),
  ])

  return {
    all:      (allRes.data ?? []).map(a => ({ id: a.id, name: a.name ?? '' })),
    selected: (selectedRes.data ?? []).map(r => r.amenity_id),
  }
}

/** Replaces the full set of amenities for a library (diff + upsert/delete) */
export async function updateLibraryAmenities(
  libraryId:    string,
  amenityIds:   string[],
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  // Fetch current links
  const { data: current } = await supabase
    .from('library_amenities').select('amenity_id').eq('library_id', libraryId)

  const currentIds = new Set((current ?? []).map(r => r.amenity_id))
  const nextIds    = new Set(amenityIds)

  const toAdd    = amenityIds.filter(id => !currentIds.has(id))
  const toRemove = [...currentIds].filter(id => !nextIds.has(id))

  if (toAdd.length) {
    const { error } = await supabase
      .from('library_amenities')
      .insert(toAdd.map(amenity_id => ({ library_id: libraryId, amenity_id })))
    if (error) {
      logError('updateLibraryAmenities', 'Insert failed', error)
      return { success: false, error: error.message }
    }
  }

  if (toRemove.length) {
    const { error } = await supabase
      .from('library_amenities')
      .delete()
      .eq('library_id', libraryId)
      .in('amenity_id', toRemove)
    if (error) {
      logError('updateLibraryAmenities', 'Delete failed', error)
      return { success: false, error: error.message }
    }
  }

  log('updateLibraryAmenities', `library=${libraryId} added=${toAdd.length} removed=${toRemove.length}`)
  revalidatePath('/dashboard/my-libraries')
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY EDIT — PHOTOS
═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY EDIT — PHOTOS
═══════════════════════════════════════════════════════════════════════════ */

/** Returns all photos for a library */
export async function getLibraryPhotos(
  libraryId: string,
): Promise<{ id: string; image_url: string; is_cover: boolean }[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('library_images')
    .select('id, image_url, is_cover')
    .eq('library_id', libraryId)
    .eq('deleted', false)
    .order('is_cover', { ascending: false })  // covers first
    .order('created_at', { ascending: true })

  if (error) { logError('getLibraryPhotos', 'Query failed', error); return [] }
  return (data ?? []).map(r => ({
    id:        r.id,
    image_url: r.image_url ?? '',
    is_cover:  r.is_cover ?? false,
  }))
}

/**
 * Uploads a new photo and stores it.
 *
 * NOTE: This action receives base64 data from the client and uploads to
 * Supabase Storage bucket "library-images". Make sure that bucket exists
 * and the service-role key has write access.
 *
 * Bucket name: "library-images"  (create via Supabase dashboard if needed)
 * Path pattern: `{libraryId}/{timestamp}-{random}.{ext}`
 */
export async function addLibraryPhoto(
  libraryId: string,
  base64Data: string,
  mimeType:   string,
  isCover:    boolean,
): Promise<ActionResult<{ photoId: string; imageUrl: string }>> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  // Convert base64 → Uint8Array
  const binaryStr = atob(base64Data)
  const bytes     = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

  const ext      = mimeType.split('/')[1] ?? 'jpg'
  const fileName = `${libraryId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const BUCKET   = 'library-images'

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, bytes, { contentType: mimeType, upsert: false })

  if (uploadErr) { logError('addLibraryPhoto', 'Upload failed', uploadErr); return { success: false, error: uploadErr.message } }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path)
  const imageUrl = urlData.publicUrl

  // If this is a cover, unset the old cover
  if (isCover) {
    await supabase
      .from('library_images')
      .update({ is_cover: false })
      .eq('library_id', libraryId)
      .eq('is_cover', true)
  }

  const { data: photo, error: dbErr } = await supabase
    .from('library_images')
    .insert({ library_id: libraryId, image_url: imageUrl, is_cover: isCover, deleted: false })
    .select('id')
    .single()

  if (dbErr || !photo) {
    logError('addLibraryPhoto', 'DB insert failed', dbErr)
    return { success: false, error: dbErr?.message ?? 'Failed to save photo record' }
  }

  log('addLibraryPhoto', `library=${libraryId} photo=${photo.id} cover=${isCover}`)
  revalidatePath('/dashboard/my-libraries')
  return { success: true, data: { photoId: photo.id, imageUrl } }
}

/** Sets an existing photo as the cover (unsets all others first) */
export async function updateLibraryCover(
  libraryId: string,
  photoId:   string,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  // Verify photo belongs to this library
  const { data: photo } = await supabase
    .from('library_images').select('library_id').eq('id', photoId).maybeSingle()
  if ((photo as any)?.library_id !== libraryId) return { success: false, error: 'Photo not found in this library' }

  // Unset all covers first, then set this one
  const { error: unsetErr } = await supabase
    .from('library_images')
    .update({ is_cover: false })
    .eq('library_id', libraryId)
  if (unsetErr) { logError('updateLibraryCover', 'Unset failed', unsetErr); return { success: false, error: unsetErr.message } }

  const { error: setErr } = await supabase
    .from('library_images')
    .update({ is_cover: true })
    .eq('id', photoId)
  if (setErr) { logError('updateLibraryCover', 'Set failed', setErr); return { success: false, error: setErr.message } }

  log('updateLibraryCover', `library=${libraryId} photo=${photoId}`)
  revalidatePath('/dashboard/my-libraries')
  return { success: true, data: undefined }
}

/** Soft-deletes a library photo */
export async function deleteLibraryPhoto(
  libraryId: string,
  photoId:   string,
): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const { data: photo } = await supabase
    .from('library_images').select('library_id, is_cover').eq('id', photoId).maybeSingle()
  if ((photo as any)?.library_id !== libraryId) return { success: false, error: 'Photo not found in this library' }

  // Soft-delete
  const { error } = await supabase
    .from('library_images').update({ deleted: true, is_cover: false }).eq('id', photoId)

  if (error) { logError('deleteLibraryPhoto', 'Delete failed', error); return { success: false, error: error.message } }

  log('deleteLibraryPhoto', `library=${libraryId} photo=${photoId}`)
  revalidatePath('/dashboard/my-libraries')
  return { success: true, data: undefined }
}