/**
 * Currency: 10000 → "₹10k", 150000 → "₹1.5L"
 */
export function fmtCurrency(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000)   return `₹${(n / 1_000).toFixed(1)}k`
  return `₹${n.toLocaleString('en-IN')}`
}

/**
 * ISO / IST string → "09:30 AM"
 */
export function fmtTime(raw: string): string {
  // Works for both ISO timestamps and plain "HH:MM:SS" IST strings
  const d = raw.includes('T') ? new Date(raw) : new Date(`1970-01-01T${raw}`)
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

/**
 * Returns hour (0-23) from an IST DB string like "09:30:00" or ISO
 */
export function getISTHour(raw: string): number {
  return parseInt(raw.slice(0, 2), 10)
}

/**
 * Arrow + percent string comparing two values
 */
export function pctDelta(now: number, prev: number): string {
  if (!prev) return now > 0 ? '+100%' : '—'
  const d = Math.round(((now - prev) / prev) * 100)
  return (d >= 0 ? '↑ ' : '↓ ') + Math.abs(d) + '%'
}

export function deltaColor(now: number, prev: number, accent = '#0D7C54'): string {
  return now >= prev ? accent : '#C5282C'
}

/**
 * IST-localised date string: "Monday, 12 May 2025"
 */
export function fmtISTDate(date = new Date()): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

// ── ADD THESE to your existing lib/utils.ts ──────────────────────────────────

/**
 * "HH:MM:SS" or ISO → "6 AM – 10 PM" style open hours string
 */
export function fmtOpenHours(openRaw: string, closeRaw: string): string {
  return `${fmtTime(openRaw)} – ${fmtTime(closeRaw)}`
}

/**
 * Check if library is open right now (IST)
 * Accepts "HH:MM:SS" strings from Postgres time column
 */
export function isOpenNow(openRaw: string, closeRaw: string): boolean {
  const nowIST = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  )
  const nowMin = nowIST.getHours() * 60 + nowIST.getMinutes()
  const openMin  = getISTHour(openRaw)  * 60 + parseInt(openRaw.slice(3, 5),  10)
  const closeMin = getISTHour(closeRaw) * 60 + parseInt(closeRaw.slice(3, 5), 10)
  return nowMin >= openMin && nowMin < closeMin
}

/**
 * Build a Postgres-compatible IST timestamp string (no timezone suffix).
 * date: a JS Date whose Y/M/D you want, treated as IST calendar day.
 * hour, minute: IST time to set.
 * Output: "YYYY-MM-DD HH:MM:00"
 */
export function buildISTTimestamp(date: Date, hour: number, minute = 0): string {
  const y  = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d  = String(date.getDate()).padStart(2,  '0')
  const h  = String(hour).padStart(2,   '0')
  const m  = String(minute).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${m}:00`
}

/**
 * Slot definitions used across the booking flow.
 * Centralised here so owner/staff/student all reference the same slots.
 */
export const BOOKING_SLOTS = [
  { label: '6–9 AM',   startH: 6,  endH: 9  },
  { label: '9 AM–12',  startH: 9,  endH: 12 },
  { label: '12–3 PM',  startH: 12, endH: 15 },
  { label: '3–6 PM',   startH: 15, endH: 18 },
  { label: '6–9 PM',   startH: 18, endH: 21 },
  { label: '9–10 PM',  startH: 21, endH: 22 },
] as const

export type BookingSlot = typeof BOOKING_SLOTS[number]

/**
 * "EEE, dd MMM yyyy" in IST — e.g. "Mon, 12 May 2025"
 */
export function fmtISTDateShort(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}