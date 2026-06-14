// src/lib/booking/pricing.ts
/**
 * Single source of truth for booking pricing.
 *
 * RULE (per product spec):
 *   Use the slot whose [start, end) range contains the booking's START TIME
 *   on the corresponding day of week. Use that slot's effective rate
 *   (price - discount) as the ₹/hour rate for the ENTIRE booking — never
 *   split or average across multiple slots.
 *
 *   If no active slot matches, fall back to libraries.base_price.
 *
 * Used identically by:
 *  - price preview UI            (LibraryDetailClient / SlotConfigClient preview)
 *  - student.initiateBooking     (lib/actions/student.ts)
 *  - owner.manualBookSeat         (lib/actions/owner.ts)        — suggested price
 *  - staff.seniorManualBook        (lib/actions/staff-seat-actions.ts) — suggested price
 *  - booking confirmation         (re-validated server-side, never trusts client amount)
 */

import { getISTDayIndex, getISTMinutesOfDay } from '../ist'
import { type SlotConfig, effectiveSlotRate, timeToMinutes } from './types'

export type PriceResolution = {
  /** ₹ per hour to apply for the entire booking duration */
  hourlyRate: number
  /** The slot that determined the rate, or null if base_price was used */
  matchedSlot: SlotConfig | null
  /** Where the rate came from — useful for UI ("Slot rate" vs "Standard rate") */
  source: 'slot' | 'base_price'
}

/**
 * Resolves the ₹/hour rate that applies to a booking starting at `startTime`
 * (a plain IST DB string, "YYYY-MM-DDTHH:mm:ss").
 *
 * `slots` should be ALL slot configs for the library (active and inactive
 * are both fine to pass in — inactive ones are filtered out here).
 */
export function resolveHourlyRate(
  slots:     SlotConfig[],
  startTime: string,
  basePrice: number,
): PriceResolution {
  const dayIdx     = getISTDayIndex(startTime)
  const startMins  = getISTMinutesOfDay(startTime)

  const candidates = slots.filter(s =>
    s.is_active &&
    s.days.includes(dayIdx) &&
    timeToMinutes(s.start) <= startMins &&
    startMins < timeToMinutes(s.end),
  )

  if (candidates.length === 0) {
    return { hourlyRate: Number(basePrice ?? 0), matchedSlot: null, source: 'base_price' }
  }

  // Slot validation (slotValidation.ts) guarantees active slots never overlap
  // on the same day, so there should only ever be one candidate. If — due to
  // legacy data or a validation bypass — more than one matches, pick the
  // lowest effective rate deterministically rather than guessing.
  const slot = [...candidates].sort((a, b) => effectiveSlotRate(a) - effectiveSlotRate(b))[0]

  return { hourlyRate: effectiveSlotRate(slot), matchedSlot: slot, source: 'slot' }
}

/**
 * Computes the final ₹ amount for a booking. Duration is derived from
 * startTime/endTime (plain IST DB strings). Rounds UP to the nearest rupee,
 * matching the previous `Math.ceil(durationHours * base_price)` behaviour.
 */
export function calculateBookingAmount(
  slots:     SlotConfig[],
  startTime: string,
  endTime:   string,
  basePrice: number,
): { amount: number } & PriceResolution {
  const durationHours =
    (new Date(endTime + '+05:30').getTime() - new Date(startTime + '+05:30').getTime()) / 3_600_000

  const resolution = resolveHourlyRate(slots, startTime, basePrice)
  const amount     = Math.ceil(Math.max(0, durationHours) * resolution.hourlyRate)

  return { amount, ...resolution }
}