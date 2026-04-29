// src/lib/actions/owner.ts
'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/actions/auth'
import { z } from 'zod'

/* ─── helpers ─────────────────────────────────────────────────────────────── */
async function getOwnerUser() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(); end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function monthRange() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString()
  return { start, end }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OWNER LIBRARIES — list with per-library stats
═══════════════════════════════════════════════════════════════════════════ */
export type OwnerLibrary = {
  id:           string
  name:         string
  city:         string
  area:         string
  is_active:    boolean
  cover_url:    string | null
  total_seats:  number
  active_seats: number
  member_count: number
  staff_count:  number
  month_revenue: number
}

export async function getOwnerLibraries(): Promise<OwnerLibrary[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  const { data: libs } = await supabase
    .from('libraries')
    .select('id, name, city, area, is_active')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })

  if (!libs?.length) return []

  const { start, end } = monthRange()

  const results = await Promise.all(libs.map(async lib => {
    const [seats, staff, covers, subs, revenue] = await Promise.all([
      supabase.from('seats').select('id, is_active', { count: 'exact' }).eq('library_id', lib.id),
      supabase.from('staff').select('id', { count: 'exact' }).eq('library_id', lib.id),
      supabase.from('library_images').select('image_url').eq('library_id', lib.id).eq('is_cover', true).maybeSingle(),
      supabase.from('subscriptions')
        .select('id', { count: 'exact' })
        .eq('status', 'active')
        .in('plan_id',
          (await supabase.from('plan_libraries').select('plan_id').eq('library_id', lib.id)).data?.map(r => r.plan_id) ?? []
        ),
      supabase.from('payments')
        .select('amount')
        .eq('status', 'paid' as any)
        .gte('created_at', start)
        .lte('created_at', end)
        .in('booking_id',
          (await supabase.from('bookings').select('id').eq('library_id', lib.id)).data?.map(r => r.id) ?? []
        ),
    ])

    const totalSeats  = seats.data?.length ?? 0
    const activeSeats = seats.data?.filter(s => s.is_active).length ?? 0
    const monthRev    = revenue.data?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0

    return {
      id:            lib.id,
      name:          lib.name,
      city:          lib.city ?? '',
      area:          lib.area ?? '',
      is_active:     lib.is_active ?? false,
      cover_url:     covers.data?.image_url ?? null,
      total_seats:   totalSeats,
      active_seats:  activeSeats,
      member_count:  subs.count ?? 0,
      staff_count:   staff.count ?? 0,
      month_revenue: monthRev,
    }
  }))

  return results
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD STATS — 4 headline cards
═══════════════════════════════════════════════════════════════════════════ */
export type DashboardStats = {
  today_revenue:      number
  yesterday_revenue:  number
  today_bookings:     number
  yesterday_bookings: number
  occupancy_pct:      number
  occupied_seats:     number
  total_active_seats: number
  held_seats:         number
  total_members:      number
  new_members_month:  number
}

export async function getDashboardStats(libraryId: string): Promise<DashboardStats | null> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return null

  const now       = new Date()
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0)
  const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999)
  const ystStart   = new Date(todayStart); ystStart.setDate(ystStart.getDate() - 1)
  const ystEnd     = new Date(todayEnd);   ystEnd.setDate(ystEnd.getDate() - 1)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // today bookings
  const { data: todayBk } = await supabase
    .from('bookings').select('id, status')
    .eq('library_id', libraryId)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString())

  // yesterday bookings
  const { data: ystBk } = await supabase
    .from('bookings').select('id')
    .eq('library_id', libraryId)
    .gte('start_time', ystStart.toISOString())
    .lte('start_time', ystEnd.toISOString())

  // today payments
  const todayBkIds  = todayBk?.map(b => b.id) ?? []
  const ystBkIds    = ystBk?.map(b => b.id) ?? []

  const [todayRev, ystRev] = await Promise.all([
    todayBkIds.length
      ? supabase.from('payments').select('amount').eq('status', 'paid' as any).in('booking_id', todayBkIds)
      : { data: [] },
    ystBkIds.length
      ? supabase.from('payments').select('amount').eq('status', 'paid' as any).in('booking_id', ystBkIds)
      : { data: [] },
  ])

  // live occupancy: bookings active RIGHT NOW
  const { data: liveOcc } = await supabase
    .from('bookings').select('id, status, seat_id')
    .eq('library_id', libraryId)
    .lte('start_time', now.toISOString())
    .gte('end_time', now.toISOString())
    .in('status', ['confirmed', 'checked_in', 'held'] as any[])

  // seats
  const { data: seats } = await supabase
    .from('seats').select('id, is_active').eq('library_id', libraryId)

  const totalActive = seats?.filter(s => s.is_active).length ?? 0
  const occupied    = liveOcc?.filter(b => ['confirmed','checked_in'].includes(b.status as string)).length ?? 0
  const held        = liveOcc?.filter(b => b.status === 'held').length ?? 0

  // members
  const planIds = (await supabase.from('plan_libraries').select('plan_id').eq('library_id', libraryId)).data?.map(r => r.plan_id) ?? []
  const [totalMem, newMem] = await Promise.all([
    planIds.length
      ? supabase.from('subscriptions').select('id', { count: 'exact' }).in('plan_id', planIds).eq('status', 'active' as any)
      : { count: 0 },
    planIds.length
      ? supabase.from('subscriptions').select('id', { count: 'exact' }).in('plan_id', planIds).gte('created_at', monthStart.toISOString())
      : { count: 0 },
  ])

  const sumAmt = (rows: any[] | null) => rows?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0

  return {
    today_revenue:      sumAmt(todayRev.data),
    yesterday_revenue:  sumAmt(ystRev.data),
    today_bookings:     todayBk?.length ?? 0,
    yesterday_bookings: ystBk?.length ?? 0,
    occupancy_pct:      totalActive ? Math.round((occupied / totalActive) * 100) : 0,
    occupied_seats:     occupied,
    total_active_seats: totalActive,
    held_seats:         held,
    total_members:      (totalMem as any).count ?? 0,
    new_members_month:  (newMem as any).count ?? 0,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONTHLY REVENUE — last 7 months bar chart data
═══════════════════════════════════════════════════════════════════════════ */
export type MonthRevPoint = { month: string; amount: number }

export async function getMonthlyRevenue(libraryId: string): Promise<MonthRevPoint[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  const months: MonthRevPoint[] = []
  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const label = d.toLocaleString('en-IN', { month: 'short' })

    const bkIds = (await supabase.from('bookings').select('id')
      .eq('library_id', libraryId)
      .gte('start_time', start)
      .lte('start_time', end)).data?.map(b => b.id) ?? []

    const rev = bkIds.length
      ? (await supabase.from('payments').select('amount').eq('status', 'paid' as any).in('booking_id', bkIds)).data
      : []

    months.push({ month: label, amount: rev?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0 })
  }

  return months
}

/* ═══════════════════════════════════════════════════════════════════════════
   TODAY'S BOOKINGS TABLE
═══════════════════════════════════════════════════════════════════════════ */
export type TodayBooking = {
  id:          string
  seat_label:  string
  student:     string
  phone:       string | null
  plan:        string | null
  start_time:  string
  end_time:    string
  status:      string
}

export async function getTodayBookings(libraryId: string): Promise<TodayBooking[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  const { start, end } = todayRange()

  const { data } = await supabase
    .from('bookings')
    .select(`
      id, start_time, end_time, status,
      seats(row_label, column_number),
      users(full_name, phone),
      subscriptions(plans(name))
    `)
    .eq('library_id', libraryId)
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: true })

  if (!data) return []

  return data.map((b: any) => ({
    id:         b.id,
    seat_label: b.seats ? `${b.seats.row_label}${b.seats.column_number}` : '?',
    student:    b.users?.full_name ?? 'Unknown',
    phone:      b.users?.phone
      ? b.users.phone.replace(/(\+91)(\d{2})(\d+)(\d{4})/, '$1$2••$4') // mask middle digits
      : null,
    plan:       b.subscriptions?.plans?.name ?? 'Per session',
    start_time: b.start_time,
    end_time:   b.end_time,
    status:     b.status,
  }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   SLOT HEATMAP — percentage fill per time band
═══════════════════════════════════════════════════════════════════════════ */
export type SlotBand = { label: string; start_h: number; end_h: number; pct: number; count: number }

export async function getSlotHeatmap(libraryId: string): Promise<SlotBand[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  // Use last 30 days for meaningful percentages
  const since = new Date(); since.setDate(since.getDate() - 30)

  const { data } = await supabase
    .from('bookings')
    .select('start_time')
    .eq('library_id', libraryId)
    .gte('start_time', since.toISOString())
    .in('status', ['confirmed', 'checked_in', 'completed'] as any[])

  const bands = [
    { label: '6–9 AM',   start_h: 6,  end_h: 9  },
    { label: '9 AM–12',  start_h: 9,  end_h: 12 },
    { label: '12–3 PM',  start_h: 12, end_h: 15 },
    { label: '3–6 PM',   start_h: 15, end_h: 18 },
    { label: '6–9 PM',   start_h: 18, end_h: 21 },
    { label: '9–10 PM',  start_h: 21, end_h: 22 },
  ]

  const counts = bands.map(b => {
    const cnt = data?.filter(bk => {
      const h = new Date(bk.start_time).getHours()
      return h >= b.start_h && h < b.end_h
    }).length ?? 0
    return { ...b, count: cnt }
  })

  const max = Math.max(...counts.map(c => c.count), 1)
  return counts.map(c => ({ ...c, pct: Math.round((c.count / max) * 100) }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK-IN — mark a booking as checked_in
═══════════════════════════════════════════════════════════════════════════ */
export async function checkInBooking(bookingId: string): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Verify ownership: booking must belong to one of this owner's libraries
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, library_id, libraries(owner_id)')
    .eq('id', bookingId)
    .maybeSingle()

  const ownerRaw = booking?.libraries
  const ownerId  = Array.isArray(ownerRaw) ? ownerRaw[0]?.owner_id : (ownerRaw as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'checked_in' as any })
    .eq('id', bookingId)

  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEAT MANAGER
═══════════════════════════════════════════════════════════════════════════ */
export type SeatRow = {
  id:            string
  row_label:     string
  column_number: number
  is_active:     boolean
  live_status:   'free' | 'booked' | 'held' | 'inactive'
}

export async function getSeatLayout(libraryId: string): Promise<SeatRow[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  const { data: seats } = await supabase
    .from('seats')
    .select('id, row_label, column_number, is_active')
    .eq('library_id', libraryId)
    .order('row_label').order('column_number')

  if (!seats?.length) return []

  // Current live bookings
  const now = new Date().toISOString()
  const { data: liveBookings } = await supabase
    .from('bookings')
    .select('seat_id, status')
    .eq('library_id', libraryId)
    .lte('start_time', now)
    .gte('end_time', now)
    .in('status', ['confirmed', 'checked_in', 'held'] as any[])

  const bookedSeatIds = new Set(
    liveBookings?.filter(b => ['confirmed','checked_in'].includes(b.status as string)).map(b => b.seat_id)
  )
  const heldSeatIds = new Set(
    liveBookings?.filter(b => b.status === 'held').map(b => b.seat_id)
  )

  return seats.map(s => ({
    id:            s.id,
    row_label:     s.row_label,
    column_number: s.column_number,
    is_active:     s.is_active,
    live_status:   !s.is_active       ? 'inactive'
                  : bookedSeatIds.has(s.id) ? 'booked'
                  : heldSeatIds.has(s.id)   ? 'held'
                  : 'free',
  }))
}

const updateSeatSchema = z.object({
  seatId:    z.string().uuid(),
  is_active: z.boolean().optional(),
})

export async function toggleSeatActive(
  seatId: string, libraryId: string, is_active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Ownership check
  const { data: seat } = await supabase
    .from('seats').select('library_id').eq('id', seatId).maybeSingle()
  if (!seat) return { success: false, error: 'Seat not found' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', seat.library_id).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const { error } = await supabase.from('seats').update({ is_active }).eq('id', seatId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

export async function addSeatRow(
  libraryId: string, rowLabel: string, numSeats: number,
): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id').eq('id', libraryId).maybeSingle()
  if ((lib as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  const seats = Array.from({ length: numSeats }, (_, i) => ({
    library_id: libraryId, row_label: rowLabel.toUpperCase(),
    column_number: i + 1, is_active: true,
  }))

  const { error } = await supabase.from('seats').insert(seats)
  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SLOT CONFIGURATION
   Note: slots are stored as bookings time patterns — we manage them via
   a separate concept. Since the schema doesn't have a slots table we store
   them as structured data in plan session_limit or use bookings open_time/
   close_time ranges. For production we treat slot config as advisory UI
   data keyed per library stored in a JSON column we'll add, OR we use
   library open_time/close_time + price bands stored as plans.
   For now we implement CRUD against a `library_slots` virtual structure
   stored as JSONB in libraries.description field until a proper table exists.
   ⚠ TODO: Add a `slots` table: id, library_id, start_time, end_time,
     days_mask (int bitmask Mon=1..Sun=64), base_price, discount, is_active
═══════════════════════════════════════════════════════════════════════════ */
export type SlotConfig = {
  id:       string
  start:    string   // "HH:MM"
  end:      string
  days:     string   // human "Mon–Sun"
  price:    number
  discount: number   // ₹ off
  is_active: boolean
}

// Temporary: store slots as JSONB in a metadata pattern
// Replace with a real table query once `slots` table is created
export async function getSlotConfigs(libraryId: string): Promise<SlotConfig[]> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return []

  const { data: lib } = await supabase
    .from('libraries')
    .select('owner_id, description')
    .eq('id', libraryId)
    .maybeSingle()

  if (!lib || (lib as any).owner_id !== user.id) return []

  try {
    const meta = JSON.parse((lib as any).description ?? '{}')
    return (meta.slots as SlotConfig[]) ?? []
  } catch {
    return []
  }
}

export async function upsertSlotConfig(
  libraryId: string, slot: Omit<SlotConfig, 'id'> & { id?: string },
): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id, description').eq('id', libraryId).maybeSingle()
  if (!lib || (lib as any).owner_id !== user.id) return { success: false, error: 'Access denied' }

  let meta: any = {}
  try { meta = JSON.parse((lib as any).description ?? '{}') } catch {}
  const slots: SlotConfig[] = meta.slots ?? []

  if (slot.id) {
    const idx = slots.findIndex(s => s.id === slot.id)
    if (idx >= 0) slots[idx] = { ...slot, id: slot.id }
    else slots.push({ ...slot, id: slot.id })
  } else {
    slots.push({ ...slot, id: crypto.randomUUID() })
  }

  meta.slots = slots
  const { error } = await supabase
    .from('libraries').update({ description: JSON.stringify(meta) }).eq('id', libraryId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

export async function toggleSlotConfig(
  libraryId: string, slotId: string, is_active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('owner_id, description').eq('id', libraryId).maybeSingle()
  if (!lib || (lib as any).owner_id !== user.id) return { success: false, error: 'Access denied' }

  let meta: any = {}
  try { meta = JSON.parse((lib as any).description ?? '{}') } catch {}
  const slots: SlotConfig[] = meta.slots ?? []
  const slot = slots.find(s => s.id === slotId)
  if (!slot) return { success: false, error: 'Slot not found' }
  slot.is_active = is_active
  meta.slots = slots

  const { error } = await supabase
    .from('libraries').update({ description: JSON.stringify(meta) }).eq('id', libraryId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAN BUILDER
═══════════════════════════════════════════════════════════════════════════ */
export type PlanWithStats = {
  id:           string
  name:         string
  price:        number
  duration_days: number
  session_limit: string | null
  scope:        string   // 'library' | 'cross'
  is_active:    boolean
  subscriber_count: number
  libraries:    { id: string; name: string }[]
}

export async function getOwnerPlans(ownerId?: string): Promise<PlanWithStats[]> {
  const { supabase, user } = await getOwnerUser()
  const uid = ownerId ?? user?.id
  if (!uid) return []

  const { data: plans } = await supabase
    .from('plans')
    .select(`
      id, name, price, duration_days, session_limit, scope,
      plan_libraries(library_id, libraries(id, name))
    `)
    .eq('owner_id', uid)
    .order('created_at', { ascending: false })

  if (!plans) return []

  const withStats = await Promise.all(plans.map(async p => {
    const { count } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', p.id)
      .eq('status', 'active' as any)

    const libs = ((p as any).plan_libraries ?? []).map((pl: any) => ({
      id:   pl.libraries?.id   ?? pl.library_id,
      name: pl.libraries?.name ?? '',
    }))

    return {
      id:               p.id,
      name:             p.name ?? '',
      price:            Number(p.price ?? 0),
      duration_days:    p.duration_days ?? 30,
      session_limit:    p.session_limit ?? null,
      scope:            (p.scope as string) ?? 'library',
      is_active:        true, // no is_active column on plans — active if not archived
      subscriber_count: count ?? 0,
      libraries:        libs,
    }
  }))

  return withStats
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

  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { name, price, duration_days, session_limit, scope, library_ids } = parsed.data

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .insert({ owner_id: user.id, name, price, duration_days, session_limit: session_limit ?? null, scope: scope as any })
    .select('id')
    .single()

  if (planErr || !plan) return { success: false, error: planErr?.message ?? 'Failed to create plan' }

  const links = library_ids.map(lid => ({ plan_id: plan.id, library_id: lid }))
  const { error: linkErr } = await supabase.from('plan_libraries').insert(links)
  if (linkErr) return { success: false, error: linkErr.message }

  return { success: true, data: { planId: plan.id } }
}

export async function archivePlan(planId: string): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Verify ownership
  const { data: plan } = await supabase
    .from('plans').select('owner_id').eq('id', planId).maybeSingle()
  if ((plan as any)?.owner_id !== user.id) return { success: false, error: 'Access denied' }

  // Set all active subscriptions to cancelled, remove plan_libraries
  await supabase.from('plan_libraries').delete().eq('plan_id', planId)
  const { error } = await supabase.from('plans').delete().eq('id', planId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE LIBRARY ACTIVE STATUS
═══════════════════════════════════════════════════════════════════════════ */
export async function toggleLibraryActive(
  libraryId: string, is_active: boolean,
): Promise<ActionResult> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { error } = await supabase
    .from('libraries')
    .update({ is_active })
    .eq('id', libraryId)
    .eq('owner_id', user.id)

  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET FIRST OWNER LIBRARY ID — for default dashboard selection
═══════════════════════════════════════════════════════════════════════════ */
export async function getFirstLibraryId(): Promise<string | null> {
  const { supabase, user } = await getOwnerUser()
  if (!user) return null
  const { data } = await supabase
    .from('libraries').select('id').eq('owner_id', user.id)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data as any)?.id ?? null
}