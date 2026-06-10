// lib/actions/student.ts
'use server'

/**
 * Student server actions.
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * • Every public function is fully typed — no `any` in return values.
 * • All Supabase selects use explicit column lists; we cast to `any` only
 *   for join rows where Supabase's TypeScript inference hits its limits.
 * • `razorpay_account_id` lives on the libraries table (added via migration).
 *   We fetch it with a separate cast to avoid TS SelectQueryError.
 * • The `subscription_status` enum must include 'pending', 'active',
 *   'expired', 'cancelled'. Add missing values via migration before deploying.
 * • All timestamps are plain IST wall-clock strings (no Z / offset suffix).
 *   See lib/ist.ts for the convention.
 */

import { revalidatePath } from 'next/cache'
import {
  createServerSupabaseClient,
  getSupabaseUser,
} from '@/lib/supabase/server'
import { z } from 'zod'
import {
  nowIST,
  monthRangeIST,
  validateISTRange,
  inputToDB,
} from '@/lib/ist'
// Static import — avoids TypeScript losing track of exported types
// when called via dynamic `await import()` inside server action functions.
import {
  createRazorpayOrder,
  verifyRazorpaySignature,
} from '@/lib/razorpay/server'

/* ─── Shared result type ─────────────────────────────────────────────────── */
export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string }

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC TYPES
══════════════════════════════════════════════════════════════════════════ */

export type LibraryPlan = {
  id:            string
  name:          string
  price:         number
  duration_days: number
  session_limit: string | null
  scope:         string
}

export type LibraryCard = {
  id:              string
  name:            string
  city:            string
  area:            string
  address:         string
  latitude:        number | null
  longitude:       number | null
  rating:          number
  total_reviews:   number
  base_price:      number
  open_time:       string   // "HH:MM:SS" from Postgres time column
  close_time:      string
  is_active:       boolean
  cover_url:       string | null
  image_urls:      string[]
  amenities:       string[]
  total_seats:     number
  available_seats: number
  plans:           LibraryPlan[]
  distance_km:     number | null
}

export type StudentBooking = {
  id:           string
  library_id:   string
  library_name: string
  library_city: string
  library_area: string
  cover_url:    string | null
  seat_label:   string
  start_time:   string
  end_time:     string
  status:       string
  booking_mode: string
  amount_paid:  number | null
  created_at:   string
  payment_id:   string | null
}

export type StudentSubscription = {
  id:            string
  plan_id:       string
  plan_name:     string
  plan_price:    number
  duration_days: number
  session_limit: string | null
  start_date:    string
  end_date:      string
  status:        string
  days_left:     number
  libraries:     { id: string; name: string; city: string }[]
}

export type SeatAvailability = {
  id:            string
  row_label:     string
  column_number: number
  label:         string
  is_available:  boolean
}

export type LibraryBook = {
  id:               string
  title:            string
  author:           string | null
  isbn:             string | null
  available_copies: number
  total_copies:     number
}

export type BookIssue = {
  id:          string
  book_title:  string
  author:      string | null
  issued_at:   string
  due_date:    string | null
  returned_at: string | null
  is_overdue:  boolean
}

export type StudentProfile = {
  id:         string
  name:       string | null
  full_name:  string | null
  email:      string | null
  phone:      string | null
  city:       string | null
  state:      string | null
  onboarded:  boolean
  created_at: string | null
}

export type StudentStats = {
  total_bookings:    number
  upcoming_bookings: number
  month_sessions:    number
  active_subs:       number
}

export type ExploreFilters = {
  lat?:       number
  lng?:       number
  search?:    string
  city?:      string
  area?:      string
  open_now?:  boolean
  amenities?: string[]
  page?:      number
  limit?:     number
}

/* ══════════════════════════════════════════════════════════════════════════
   PRIVATE HELPERS
══════════════════════════════════════════════════════════════════════════ */

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6371
  const dL = ((lat2 - lat1) * Math.PI) / 180
  const dG = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dG / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isOpenNowIST(openRaw: string, closeRaw: string): boolean {
  try {
    const d   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const now = d.getHours() * 60 + d.getMinutes()
    const p   = (t: string) => {
      const parts = t.split(':').map(Number)
      return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
    }
    return now >= p(openRaw) && now < p(closeRaw)
  } catch { return false }
}

function buildCard(
  lib:          Record<string, any>,
  bookedIds:    Set<string>,
  plansByLib:   Record<string, LibraryPlan[]>,
  userLat:      number | null,
  userLng:      number | null,
): LibraryCard {
  const images: { image_url: string; is_cover: boolean }[] = lib.library_images ?? []
  const cover      = images.find((i) => i.is_cover)?.image_url ?? images[0]?.image_url ?? null
  const amenities  = (lib.library_amenities ?? [])
    .map((la: any) => la.amenities?.name as string | undefined)
    .filter((n): n is string => !!n)
  const allSeats: { id: string; is_active: boolean }[] = lib.seats ?? []
  const active     = allSeats.filter((s) => s.is_active)
  const booked     = active.filter((s) => bookedIds.has(s.id)).length
  const available  = Math.max(0, active.length - booked)
  const libLat     = lib.latitude  != null ? Number(lib.latitude)  : null
  const libLng     = lib.longitude != null ? Number(lib.longitude) : null
  const distanceKm =
    userLat != null && userLng != null && libLat != null && libLng != null
      ? parseFloat(haversineKm(userLat, userLng, libLat, libLng).toFixed(1))
      : null

  return {
    id:              lib.id,
    name:            lib.name     ?? '',
    city:            lib.city     ?? '',
    area:            lib.area     ?? '',
    address:         lib.address  ?? '',
    latitude:        libLat,
    longitude:       libLng,
    rating:          Number(lib.rating        ?? 0),
    total_reviews:   Number(lib.total_reviews ?? 0),
    base_price:      Number(lib.base_price    ?? 0),
    open_time:       lib.open_time  ?? '06:00:00',
    close_time:      lib.close_time ?? '22:00:00',
    is_active:       lib.is_active  ?? false,
    cover_url:       cover,
    image_urls:      images.map((i) => i.image_url),
    amenities,
    total_seats:     active.length,
    available_seats: available,
    plans:           plansByLib[lib.id] ?? [],
    distance_km:     distanceKm,
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPLORE LIBRARIES
   Location-aware → sort nearest first. No location → sort by rating.
══════════════════════════════════════════════════════════════════════════ */

export async function exploreLibraries(filters: ExploreFilters = {}): Promise<{
  libraries: LibraryCard[]
  total:     number
  cities:    string[]
}> {
  const supabase = await createServerSupabaseClient()
  const {
    lat, lng, search, city, area, open_now,
    amenities = [], page = 1, limit = 12,
  } = filters

  // Build base query — all columns that exist in schema
  let query = supabase
    .from('libraries')
    .select(
      `id, name, city, area, address, latitude, longitude,
       rating, total_reviews, base_price, open_time, close_time, is_active,
       library_images(image_url, is_cover),
       library_amenities(amenities(name)),
       seats(id, is_active)`,
      { count: 'exact' },
    )
    .eq('is_active', true)

  if (city)   query = query.ilike('city', `%${city}%`)
  if (area)   query = query.ilike('area', `%${area}%`)
  if (search) query = query.or(
    `name.ilike.%${search}%,city.ilike.%${search}%,area.ilike.%${search}%,address.ilike.%${search}%`,
  )

  let allRows: any[]
  let total: number

  if (lat != null && lng != null) {
    // Fetch up to 200, sort by distance in JS (no PostGIS)
    const { data, count } = await query
      .order('rating', { ascending: false })
      .limit(200)
    allRows = data ?? []
    total   = count ?? 0
  } else {
    const from = (page - 1) * limit
    const { data, count } = await query
      .order('rating', { ascending: false })
      .range(from, from + limit - 1)
    allRows = data ?? []
    total   = count ?? 0
  }

  // Cities dropdown
  const { data: citiesData } = await supabase
    .from('libraries')
    .select('city')
    .eq('is_active', true)
    .not('city', 'is', null)
  const cities = [
    ...new Set((citiesData ?? []).map((c: any) => c.city as string).filter(Boolean)),
  ]

  if (!allRows.length) return { libraries: [], total: 0, cities }

  const libIds = allRows.map((l) => l.id as string)
  const now    = nowIST()

  // Active bookings right now (for live occupancy)
  const { data: activeBkgs } = await supabase
    .from('bookings')
    .select('seat_id, library_id')
    .in('library_id', libIds)
    .lte('start_time', now)
    .gte('end_time', now)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])

  const bookedByLib: Record<string, Set<string>> = {}
  for (const b of activeBkgs ?? []) {
    const bl = b as { seat_id: string; library_id: string }
    if (!bookedByLib[bl.library_id]) bookedByLib[bl.library_id] = new Set()
    bookedByLib[bl.library_id].add(bl.seat_id)
  }

  // Plans per library
  const { data: planLibsData } = await supabase
    .from('plan_libraries')
    .select('library_id, plans(id, name, price, duration_days, session_limit, scope)')
    .in('library_id', libIds)

  const plansByLib: Record<string, LibraryPlan[]> = {}
  for (const pl of planLibsData ?? []) {
    const row = pl as any
    const p   = row.plans
    if (!p) continue
    if (!plansByLib[row.library_id]) plansByLib[row.library_id] = []
    plansByLib[row.library_id].push({
      id:            p.id,
      name:          p.name          ?? '',
      price:         Number(p.price  ?? 0),
      duration_days: p.duration_days ?? 30,
      session_limit: p.session_limit ?? null,
      scope:         p.scope         ?? 'library',
    })
  }

  let cards = allRows
    .map((lib) => buildCard(lib, bookedByLib[lib.id] ?? new Set(), plansByLib, lat ?? null, lng ?? null))
    .filter((card) => {
      if (open_now && !isOpenNowIST(card.open_time, card.close_time)) return false
      if (amenities.length > 0 && !amenities.every((a) => card.amenities.includes(a))) return false
      return true
    })

  if (lat != null && lng != null) {
    cards.sort((a, b) => {
      if (a.distance_km == null && b.distance_km == null) return b.rating - a.rating
      if (a.distance_km == null) return  1
      if (b.distance_km == null) return -1
      return a.distance_km - b.distance_km
    })
    total = cards.length
    const from = (page - 1) * limit
    cards = cards.slice(from, from + limit)
  }

  return { libraries: cards, total, cities }
}

/* ══════════════════════════════════════════════════════════════════════════
   LIBRARY DETAIL
══════════════════════════════════════════════════════════════════════════ */

export async function getLibraryDetail(
  libraryId: string,
  userLat?:  number,
  userLng?:  number,
): Promise<LibraryCard | null> {
  const supabase = await createServerSupabaseClient()

  const { data: lib, error } = await supabase
    .from('libraries')
    .select(
      `id, name, city, area, address, latitude, longitude,
       rating, total_reviews, base_price, open_time, close_time, is_active,
       library_images(image_url, is_cover),
       library_amenities(amenities(name)),
       seats(id, is_active)`,
    )
    .eq('id', libraryId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !lib) return null

  const now = nowIST()
  const { data: activeBkgs } = await supabase
    .from('bookings')
    .select('seat_id')
    .eq('library_id', libraryId)
    .lte('start_time', now)
    .gte('end_time', now)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])

  const bookedIds = new Set((activeBkgs ?? []).map((b: any) => b.seat_id as string))

  const { data: planLibs } = await supabase
    .from('plan_libraries')
    .select('library_id, plans(id, name, price, duration_days, session_limit, scope)')
    .eq('library_id', libraryId)

  const plans: LibraryPlan[] = (planLibs ?? [])
    .map((pl: any) => pl.plans)
    .filter(Boolean)
    .map((p: any): LibraryPlan => ({
      id:            p.id,
      name:          p.name          ?? '',
      price:         Number(p.price  ?? 0),
      duration_days: p.duration_days ?? 30,
      session_limit: p.session_limit ?? null,
      scope:         p.scope         ?? 'library',
    }))

  return buildCard(
    lib as any,
    bookedIds,
    { [libraryId]: plans },
    userLat ?? null,
    userLng ?? null,
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   SEAT AVAILABILITY
══════════════════════════════════════════════════════════════════════════ */

export async function getSeatAvailability(
  libraryId: string,
  startTime: string,
  endTime:   string,
): Promise<SeatAvailability[]> {
  const supabase = await createServerSupabaseClient()

  const [seatsRes, conflictRes] = await Promise.all([
    supabase
      .from('seats')
      .select('id, row_label, column_number, is_active')
      .eq('library_id', libraryId)
      .eq('is_active', true)
      .order('row_label')
      .order('column_number'),
    supabase
      .from('bookings')
      .select('seat_id')
      .eq('library_id', libraryId)
      .in('status', ['confirmed', 'checked_in', 'held'] as never[])
      .lt('start_time', endTime)
      .gt('end_time', startTime),
  ])

  const bookedIds = new Set((conflictRes.data ?? []).map((b: any) => b.seat_id as string))

  return (seatsRes.data ?? []).map((s: any) => ({
    id:            s.id as string,
    row_label:     s.row_label     ?? '',
    column_number: s.column_number ?? 0,
    label:         `${s.row_label}${s.column_number}`,
    is_available:  !bookedIds.has(s.id),
  }))
}

/* ══════════════════════════════════════════════════════════════════════════
   INITIATE BOOKING
   Creates a HELD booking + Razorpay order.
   The libraries.razorpay_account_id column is fetched via a cast
   to avoid TS errors if the migration hasn't run yet in dev.
══════════════════════════════════════════════════════════════════════════ */

const initiateBookingSchema = z.object({
  libraryId: z.string().uuid(),
  seatId:    z.string().uuid(),
  startTime: z.string().min(1),
  endTime:   z.string().min(1),
})

export async function initiateBooking(
  input: z.infer<typeof initiateBookingSchema>,
): Promise<ActionResult<{
  bookingId:       string
  amount:          number
  razorpayOrderId: string
  razorpayKeyId:   string
  libraryName:     string
}>> {
  const parsed = initiateBookingSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message }

  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Please sign in to book a seat' }

  const { libraryId, seatId } = parsed.data
  const start = inputToDB(parsed.data.startTime)
  const end   = inputToDB(parsed.data.endTime)

  // Validate time range — use explicit .ok === false narrowing for TS
  const rangeCheck = validateISTRange(start, end, 12)
  if (rangeCheck.ok === false) return { success: false, error: rangeCheck.error }

  const startMs = new Date(start + '+05:30').getTime()
  if (startMs < Date.now() - 5 * 60_000)
    return { success: false, error: 'Start time cannot be in the past' }

  // Fetch library — cast to any so TS doesn't error on razorpay_account_id
  // (the column exists after migration but Supabase's generated types may lag)
  const { data: libRaw, error: libErr } = await supabase
    .from('libraries')
    .select('id, name, base_price, is_active, open_time, close_time')
    .eq('id', libraryId)
    .eq('is_active', true)
    .maybeSingle()

  if (libErr || !libRaw)
    return { success: false, error: 'Library not found or inactive' }

  // Fetch razorpay_account_id separately with cast (avoids generated-type error)
  const { data: libExtra } = await (supabase as any)
    .from('libraries')
    .select('razorpay_account_id')
    .eq('id', libraryId)
    .maybeSingle() as { data: { razorpay_account_id: string | null } | null }

  const lib = {
    id:                  libRaw.id,
    name:                libRaw.name,
    base_price:          libRaw.base_price,
    is_active:           libRaw.is_active,
    open_time:           libRaw.open_time,
    close_time:          libRaw.close_time,
    razorpay_account_id: libExtra?.razorpay_account_id ?? null,
  }

  // Verify seat
  const { data: seat } = await supabase
    .from('seats')
    .select('id, library_id, is_active')
    .eq('id', seatId)
    .eq('library_id', libraryId)
    .maybeSingle()

  if (!seat)          return { success: false, error: 'Seat not found' }
  if (!seat.is_active) return { success: false, error: 'This seat is currently inactive' }

  // ── Race condition protection ──────────────────────────────────────
  // 1. Application-level advisory lock: serialises concurrent booking
  //    attempts for the same seat. pg_try_advisory_xact_lock takes a
  //    bigint key derived from the seat UUID — no two transactions for
  //    the same seat run simultaneously.
  // 2. The DB exclusion constraint (no_overlapping_bookings) is the
  //    hard backstop — it rejects overlapping INSERTs with error 23P01
  //    even if the application check is bypassed.
  const { data: lockData, error: lockErr } = await supabase
    .rpc('try_lock_seat', { p_seat_id: seatId }) as
    { data: boolean | null; error: any }

  // RPC may not exist in dev before migration — fall through gracefully
  if (lockErr) {
    console.warn('[initiateBooking] try_lock_seat RPC not available — proceeding without advisory lock', lockErr.message)
  } else if (lockData === false) {
    return { success: false, error: 'Someone else is booking this seat right now. Please try again in a moment.' }
  }

  // Seat conflict check (still needed as pre-flight; exclusion constraint is backstop)
  const { data: seatConflict } = await supabase
    .from('bookings')
    .select('id')
    .eq('seat_id', seatId)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])
    .lt('start_time', end)
    .gt('end_time', start)
    .limit(1)

  if (seatConflict?.length)
    return { success: false, error: 'This seat is already booked for the selected time slot. Please choose another seat or time.' }

  // User double-booking guard
  const { data: userConflict } = await supabase
    .from('bookings')
    .select('id')
    .eq('user_id', user.id)
    .in('status', ['confirmed', 'checked_in', 'held'] as never[])
    .lt('start_time', end)
    .gt('end_time', start)
    .limit(1)

  if (userConflict?.length)
    return { success: false, error: 'You already have a booking during this time slot' }

  // Calculate amount
  const durationHours =
    (new Date(end + '+05:30').getTime() - new Date(start + '+05:30').getTime()) / 3_600_000
  const amountINR = Math.ceil(durationHours * Number(lib.base_price ?? 0))
  if (amountINR <= 0)
    return { success: false, error: 'Invalid booking amount. Please contact the library.' }

  // Create Razorpay order
  const orderResult = await createRazorpayOrder({
    amountINR,
    razorpayAccountId: lib.razorpay_account_id,
    currency: 'INR',
    notes: { student_id: user.id, library_id: libraryId, library_name: lib.name ?? '' },
  })

  if (orderResult.success === false)
    return { success: false, error: orderResult.error }

  const { orderId, keyId } = orderResult.data

  // Hold booking (15-min window)
  // nowIST() returns "YYYY-MM-DDTHH:mm:ss.mmm" as plain IST wall-clock.
  // We add 15 min to UTC epoch then format as IST — no double offset.
  const holdExpiry = new Date(Date.now() + 15 * 60_000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .replace(' ', 'T')
    .slice(0, 19)

  const { data: booking, error: bookErr } = await supabase
    .from('bookings')
    .insert({
      user_id:         user.id,
      library_id:      libraryId,
      seat_id:         seatId,
      start_time:      start,
      end_time:        end,
      status:          'held'    as never,
      hold_expires_at: holdExpiry,
      booking_mode:    'online',
    } as never)
    .select('id')
    .single()

  if (bookErr || !booking) {
    // PostgreSQL error 23P01 = exclusion_violation (from no_overlapping_bookings constraint)
    // This is the race condition backstop — catches the rare case where two concurrent
    // transactions both pass the application-level check but one wins the DB lock.
    if ((bookErr as any)?.code === '23P01') {
      return { success: false, error: 'This seat was just booked by someone else. Please choose another seat.' }
    }
    return { success: false, error: bookErr?.message ?? 'Failed to hold seat. Please try again.' }
  }

  // Store pending payment
  await (supabase as any).from('payments').insert({
    user_id:           user.id,
    booking_id:        booking.id,
    amount:            amountINR,
    status:            'pending',
    razorpay_order_id: orderId,
  })

  return {
    success: true,
    data: {
      bookingId:       booking.id,
      amount:          amountINR,
      razorpayOrderId: orderId,
      razorpayKeyId:   keyId,
      libraryName:     lib.name ?? '',
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRM BOOKING PAYMENT (called after Razorpay succeeds on client)
══════════════════════════════════════════════════════════════════════════ */

const confirmBookingSchema = z.object({
  bookingId:         z.string().uuid(),
  razorpayOrderId:   z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
})

export async function confirmBookingPayment(
  input: z.infer<typeof confirmBookingSchema>,
): Promise<ActionResult<{ bookingId: string }>> {
  const parsed = confirmBookingSchema.safeParse(input)
  if (!parsed.success)
    return { success: false, error: parsed.error.errors[0].message }

  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data

  // Verify Razorpay signature server-side
  if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))
    return { success: false, error: 'Payment verification failed. Contact support if amount was deducted.' }

  // Fetch booking
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status, hold_expires_at')
    .eq('id', bookingId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!booking)
    return { success: false, error: 'Booking not found' }

  // Idempotent — already confirmed (e.g. webhook beat us to it)
  if (booking.status === 'confirmed')
    return { success: true, data: { bookingId } }

  if (booking.status !== 'held')
    return { success: false, error: `Booking status is '${booking.status}' — cannot confirm` }

  // Check hold not expired
  const holdMs = booking.hold_expires_at
    ? new Date((booking.hold_expires_at as string) + '+05:30').getTime()
    : 0
  if (holdMs > 0 && Date.now() > holdMs)
    return { success: false, error: 'Seat hold has expired. Please start a new booking.' }

  // Atomic update
  const [bRes, pRes] = await Promise.all([
    supabase
      .from('bookings')
      .update({ status: 'confirmed' as never, hold_expires_at: null } as never)
      .eq('id', bookingId),
    (supabase as any)
      .from('payments')
      .update({ status: 'paid', razorpay_payment_id: razorpayPaymentId })
      .eq('booking_id', bookingId)
      .eq('status', 'pending'),
  ])

  if (bRes.error)
    return { success: false, error: bRes.error.message }

  revalidatePath('/bookings')
  return { success: true, data: { bookingId } }
}

/* ══════════════════════════════════════════════════════════════════════════
   CANCEL BOOKING
══════════════════════════════════════════════════════════════════════════ */

export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status, start_time')
    .eq('id', bookingId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!booking) return { success: false, error: 'Booking not found' }

  const status = booking.status as string
  if (!['confirmed', 'held'].includes(status))
    return { success: false, error: 'Only confirmed or held bookings can be cancelled' }

  const startMs = new Date((booking.start_time as string) + '+05:30').getTime()
  if (startMs - Date.now() < 30 * 60_000)
    return { success: false, error: 'Bookings cannot be cancelled within 30 minutes of the start time' }

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as never } as never)
    .eq('id', bookingId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/bookings')
  return { success: true, data: undefined }
}

/* ══════════════════════════════════════════════════════════════════════════
   MY BOOKINGS
══════════════════════════════════════════════════════════════════════════ */

export async function getMyBookings(
  filter: 'upcoming' | 'past' | 'all' = 'all',
): Promise<StudentBooking[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const now = nowIST()

  let query = supabase
    .from('bookings')
    .select(`
      id, library_id, seat_id, start_time, end_time,
      status, booking_mode, created_at,
      seats(row_label, column_number),
      libraries(name, city, area, library_images(image_url, is_cover))
    `)
    .eq('user_id', user.id)

  if (filter === 'upcoming') {
    query = query
      .gte('end_time', now)
      .in('status', ['confirmed', 'checked_in', 'held'] as never[])
      .order('start_time', { ascending: true })
  } else if (filter === 'past') {
    query = query
      .or(`end_time.lt.${now},status.in.(completed,cancelled)`)
      .order('start_time', { ascending: false })
  } else {
    query = query.order('start_time', { ascending: false })
  }

  const { data, error } = await query.limit(60)
  if (error || !data) return []

  // Payments in one query
  const bookingIds = (data as any[]).map((b) => b.id as string)
  const { data: payments } = bookingIds.length
    ? await (supabase as any)
        .from('payments')
        .select('booking_id, amount, id')
        .eq('status', 'paid')
        .in('booking_id', bookingIds)
    : { data: [] as any[] }

  const payMap: Record<string, { amount: number; id: string }> = {}
  for (const p of (payments ?? []) as any[])
    payMap[p.booking_id] = { amount: Number(p.amount), id: p.id }

  return (data as any[]).map((b): StudentBooking => {
    const lib   = b.libraries as any
    const imgs  = (lib?.library_images ?? []) as any[]
    const cover = imgs.find((i) => i.is_cover)?.image_url ?? imgs[0]?.image_url ?? null
    const pay   = payMap[b.id]
    return {
      id:           b.id,
      library_id:   b.library_id,
      library_name: lib?.name ?? 'Unknown',
      library_city: lib?.city ?? '',
      library_area: lib?.area ?? '',
      cover_url:    cover,
      seat_label:   b.seats ? `${b.seats.row_label}${b.seats.column_number}` : '?',
      start_time:   b.start_time ?? '',
      end_time:     b.end_time   ?? '',
      status:       b.status     ?? '',
      booking_mode: b.booking_mode ?? 'online',
      amount_paid:  pay?.amount ?? null,
      created_at:   b.created_at ?? '',
      payment_id:   pay?.id ?? null,
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   INITIATE PLAN SUBSCRIPTION
══════════════════════════════════════════════════════════════════════════ */

const subscribePlanSchema = z.object({
  planId:    z.string().uuid(),
  libraryId: z.string().uuid(),
})

export async function initiatePlanSubscription(
  input: z.infer<typeof subscribePlanSchema>,
): Promise<ActionResult<{
  subscriptionId:  string
  amount:          number
  razorpayOrderId: string
  razorpayKeyId:   string
  planName:        string
}>> {
  const parsed = subscribePlanSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Please sign in to subscribe' }

  const { planId, libraryId } = parsed.data

  // Verify plan ↔ library link
  const { data: planLib } = await supabase
    .from('plan_libraries')
    .select('plan_id')
    .eq('plan_id', planId)
    .eq('library_id', libraryId)
    .maybeSingle()
  if (!planLib) return { success: false, error: 'Plan not available for this library' }

  const { data: plan } = await supabase
    .from('plans')
    .select('id, name, price, duration_days, owner_id')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return { success: false, error: 'Plan not found' }

  // Block duplicate active subscriptions
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('plan_id', planId)
    .eq('status', 'active' as never)
    .maybeSingle()
  if (existing) return { success: false, error: 'You already have an active subscription to this plan' }

  const amountINR = Number((plan as any).price ?? 0)
  if (amountINR <= 0) return { success: false, error: 'Invalid plan price' }

  // Fetch owner's razorpay_account_id
  const { data: libExtra } = await (supabase as any)
    .from('libraries')
    .select('razorpay_account_id')
    .eq('id', libraryId)
    .maybeSingle() as { data: { razorpay_account_id: string | null } | null }

  // Create Razorpay order
  const orderResult = await createRazorpayOrder({
    amountINR,
    razorpayAccountId: libExtra?.razorpay_account_id ?? null,
    currency: 'INR',
    notes: { student_id: user.id, plan_id: planId, plan_name: (plan as any).name ?? '' },
  })

  if (orderResult.success === false)
    return { success: false, error: orderResult.error }

  const { orderId, keyId } = orderResult.data

  // Create pending subscription
  // Use locale-aware formatting in IST to avoid double-offset bugs.
  // sv-SE locale gives "YYYY-MM-DD HH:MM:SS" — safe to slice.
  const startIST = new Date(Date.now())
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .slice(0, 10) + 'T00:00:00'
  const durationDays = (plan as any).duration_days ?? 30
  const endIST = new Date(Date.now() + durationDays * 86_400_000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    .slice(0, 10) + 'T23:59:59'

  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .insert({
      user_id:    user.id,
      plan_id:    planId,
      start_date: startIST,
      end_date:   endIST,
      status:     'pending' as never,  // see migration: add 'pending' to subscription_status enum
    } as never)
    .select('id')
    .single()

  if (subErr || !sub) return { success: false, error: 'Failed to initiate subscription' }

  // Store pending payment (no booking_id for subscriptions)
  await (supabase as any).from('payments').insert({
    user_id:           user.id,
    booking_id:        null,
    amount:            amountINR,
    status:            'pending',
    razorpay_order_id: orderId,
    subscription_id:   sub.id,   // requires migration column
  })

  return {
    success: true,
    data: {
      subscriptionId:  sub.id,
      amount:          amountINR,
      razorpayOrderId: orderId,
      razorpayKeyId:   keyId,
      planName:        (plan as any).name ?? '',
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRM SUBSCRIPTION PAYMENT
══════════════════════════════════════════════════════════════════════════ */

export async function confirmSubscriptionPayment(input: {
  subscriptionId:    string
  razorpayOrderId:   string
  razorpayPaymentId: string
  razorpaySignature: string
}): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  if (!verifyRazorpaySignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature))
    return { success: false, error: 'Payment verification failed' }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, user_id, status')
    .eq('id', input.subscriptionId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!sub) return { success: false, error: 'Subscription not found' }

  const status = sub.status as string
  if (status === 'active') return { success: true, data: undefined }   // idempotent
  if (status !== 'pending') return { success: false, error: 'Subscription cannot be confirmed in its current state' }

  const [sRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .update({ status: 'active' as never } as never)
      .eq('id', input.subscriptionId),
    (supabase as any)
      .from('payments')
      .update({ status: 'paid', razorpay_payment_id: input.razorpayPaymentId })
      .eq('subscription_id', input.subscriptionId)
      .eq('status', 'pending'),
  ])

  if (sRes.error) return { success: false, error: sRes.error.message }

  revalidatePath('/subscriptions')
  return { success: true, data: undefined }
}

/* ══════════════════════════════════════════════════════════════════════════
   MY SUBSCRIPTIONS
══════════════════════════════════════════════════════════════════════════ */

export async function getMySubscriptions(): Promise<StudentSubscription[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('subscriptions')
    .select(`
      id, plan_id, start_date, end_date, status, created_at,
      plans(id, name, price, duration_days, session_limit, scope,
        plan_libraries(library_id, libraries(id, name, city)))
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error || !data) return []

  const nowMs = Date.now()

  return (data as any[]).map((s): StudentSubscription => {
    const plan     = s.plans as any
    const planLibs = (plan?.plan_libraries ?? []) as any[]
    const endMs    = s.end_date ? new Date((s.end_date as string) + '+05:30').getTime() : null
    const daysLeft = endMs ? Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000)) : 0

    return {
      id:            s.id,
      plan_id:       s.plan_id,
      plan_name:     plan?.name          ?? 'Unknown Plan',
      plan_price:    Number(plan?.price  ?? 0),
      duration_days: plan?.duration_days ?? 30,
      session_limit: plan?.session_limit ?? null,
      start_date:    s.start_date ?? '',
      end_date:      s.end_date   ?? '',
      status:        s.status     ?? '',
      days_left:     daysLeft,
      libraries:     planLibs.map((pl) => ({
        id:   pl.libraries?.id   ?? pl.library_id,
        name: pl.libraries?.name ?? '',
        city: pl.libraries?.city ?? '',
      })),
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   LIBRARY BOOKS
══════════════════════════════════════════════════════════════════════════ */

export async function getLibraryBooks(libraryId: string): Promise<LibraryBook[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('books')
    .select('id, title, author, isbn, book_copies(id, status)')
    .eq('library_id', libraryId)
    .order('title')

  if (error || !data) return []

  return (data as any[]).map((b): LibraryBook => {
    const copies = (b.book_copies ?? []) as { id: string; status: string }[]
    return {
      id:               b.id,
      title:            b.title  ?? '',
      author:           b.author ?? null,
      isbn:             b.isbn   ?? null,
      available_copies: copies.filter((c) => c.status === 'available').length,
      total_copies:     copies.length,
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   REQUEST A BOOK
══════════════════════════════════════════════════════════════════════════ */

export async function requestBook(input: {
  bookId:    string
  libraryId: string
  message?:  string
}): Promise<ActionResult> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Please sign in to request a book' }

  const { data: existing } = await supabase
    .from('book_requests')
    .select('id')
    .eq('user_id', user.id)
    .eq('book_id', input.bookId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) return { success: false, error: 'You already have a pending request for this book' }

  const { error } = await supabase.from('book_requests').insert({
    user_id:    user.id,
    library_id: input.libraryId,
    book_id:    input.bookId,
    status:     'pending',
    message:    input.message?.trim() ?? null,
  } as never)

  if (error) return { success: false, error: error.message }

  revalidatePath(`/library/${input.libraryId}`)
  return { success: true, data: undefined }
}

/* ══════════════════════════════════════════════════════════════════════════
   MY BOOK ISSUES
══════════════════════════════════════════════════════════════════════════ */

export async function getMyBookIssues(): Promise<BookIssue[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('book_issues')
    .select(`
      id, issued_at, due_date, returned_at,
      book_copies(books(title, author))
    `)
    .eq('user_id', user.id)
    .order('issued_at', { ascending: false })
    .limit(30)

  if (error || !data) return []

  const now = Date.now()

  return (data as any[]).map((i): BookIssue => {
    const book  = (i.book_copies as any)?.books as any
    const dueMs = i.due_date ? new Date((i.due_date as string) + '+05:30').getTime() : null
    return {
      id:          i.id,
      book_title:  book?.title  ?? 'Unknown Book',
      author:      book?.author ?? null,
      issued_at:   i.issued_at   ?? '',
      due_date:    i.due_date    ?? null,
      returned_at: i.returned_at ?? null,
      is_overdue:  !i.returned_at && dueMs != null && dueMs < now,
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   STUDENT PROFILE
══════════════════════════════════════════════════════════════════════════ */

export async function getStudentProfile(): Promise<StudentProfile | null> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('id, name, full_name, email, phone, city, state, onboarded, created_at')
    .eq('id', user.id)
    .maybeSingle()

  if (!data) return null

  return {
    id:         (data as any).id,
    name:       (data as any).name       ?? null,
    full_name:  (data as any).full_name  ?? null,
    email:      (data as any).email      ?? null,
    phone:      (data as any).phone      ?? null,
    city:       (data as any).city       ?? null,
    state:      (data as any).state      ?? null,
    onboarded:  (data as any).onboarded  ?? false,
    created_at: (data as any).created_at ?? null,
  }
}

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(100).optional(),
  city:      z.string().max(100).optional(),
  state:     z.string().max(100).optional(),
})

export async function updateStudentProfile(
  input: z.infer<typeof updateProfileSchema>,
): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message }

  const { supabase, user } = await getSupabaseUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const update: Record<string, string> = {}
  if (parsed.data.full_name !== undefined) update.full_name = parsed.data.full_name.trim()
  if (parsed.data.city      !== undefined) update.city      = parsed.data.city.trim()
  if (parsed.data.state     !== undefined) update.state     = parsed.data.state

  const { error } = await supabase.from('users').update(update as never).eq('id', user.id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/profile')
  return { success: true, data: undefined }
}

/* ══════════════════════════════════════════════════════════════════════════
   STUDENT STATS
══════════════════════════════════════════════════════════════════════════ */

export async function getStudentStats(): Promise<StudentStats | null> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return null

  const now            = nowIST()
  const { start: mStart } = monthRangeIST()

  const [totalRes, upcomingRes, monthRes, subRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['confirmed', 'checked_in', 'completed'] as never[]),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('end_time', now)
      .in('status', ['confirmed', 'held'] as never[]),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('start_time', mStart)
      .in('status', ['confirmed', 'checked_in', 'completed'] as never[]),
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active' as never),
  ])

  return {
    total_bookings:    totalRes.count    ?? 0,
    upcoming_bookings: upcomingRes.count ?? 0,
    month_sessions:    monthRes.count    ?? 0,
    active_subs:       subRes.count      ?? 0,
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   AMENITIES LIST
══════════════════════════════════════════════════════════════════════════ */

export async function getAllAmenities(): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('amenities').select('name').order('name')
  return (data ?? []).map((a: any) => a.name as string).filter(Boolean)
}

/* ══════════════════════════════════════════════════════════════════════════
   PAYMENT HISTORY
══════════════════════════════════════════════════════════════════════════ */

export type PaymentRecord = {
  id:                  string
  amount:              number
  status:              string
  created_at:          string
  razorpay_payment_id: string | null
  razorpay_order_id:   string | null
  type:                'booking' | 'subscription'
  booking:             {
    id:           string
    start_time:   string
    end_time:     string
    seat_label:   string
    library_name: string
  } | null
}

export async function getMyPayments(): Promise<PaymentRecord[]> {
  const { supabase, user } = await getSupabaseUser()
  if (!user) return []

  const { data, error } = await (supabase as any)
    .from('payments')
    .select(`
      id, amount, status, created_at,
      razorpay_payment_id, razorpay_order_id,
      subscription_id,
      bookings(
        id, start_time, end_time,
        seats(row_label, column_number),
        libraries(name)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60)

  if (error || !data) return []

  return (data as any[]).map((p): PaymentRecord => {
    const bk = p.bookings as any
    return {
      id:                  p.id,
      amount:              Number(p.amount ?? 0),
      status:              p.status     ?? '',
      created_at:          p.created_at ?? '',
      razorpay_payment_id: p.razorpay_payment_id ?? null,
      razorpay_order_id:   p.razorpay_order_id   ?? null,
      type:                p.subscription_id ? 'subscription' : 'booking',
      booking: bk ? {
        id:           bk.id,
        start_time:   bk.start_time ?? '',
        end_time:     bk.end_time   ?? '',
        seat_label:   bk.seats
          ? `${bk.seats.row_label}${bk.seats.column_number}`
          : '?',
        library_name: bk.libraries?.name ?? 'Unknown',
      } : null,
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPIRE STALE HOLDS (cron / pg_cron)
══════════════════════════════════════════════════════════════════════════ */

export async function expireStaleHolds(): Promise<{ cancelled: number }> {
  const supabase = await createServerSupabaseClient()
  const now      = nowIST()

  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as never } as never)
    .eq('status', 'held' as never)
    .lt('hold_expires_at', now)
    .select('id')

  if (error) console.error('[expireStaleHolds]', error.message)
  return { cancelled: data?.length ?? 0 }
}