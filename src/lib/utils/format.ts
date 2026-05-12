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