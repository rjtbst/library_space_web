// src/lib/booking/bookingValidation.ts
/**
 * Centralized booking-window validation — operating hours + past-time checks.
 *
 * Applied identically to ALL booking entry points:
 *  - student.initiateBooking          (lib/actions/student.ts)
 *  - owner.manualBookSeat              (lib/actions/owner.ts)
 *  - staff.seniorManualBook            (lib/actions/staff-seat-actions.ts)
 *
 * All start/end times here are plain IST wall-clock DB strings
 * ("YYYY-MM-DDTHH:mm:ss") — see lib/ist.ts for the storage convention.
 * open_time / close_time are Postgres `time` columns ("HH:MM:SS").
 */

import { getISTMinutesOfDay, getISTDateKey } from '../ist'
import { timeToMinutes } from './types'

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Ensures [startTime, endTime) falls within the library's daily
 * open_time–close_time window.
 *
 * Only single-day bookings (start and end on the same IST calendar date)
 * are checked against operating hours — a booking that spans midnight
 * can't be validated against a single daily window and is allowed through
 * here (other guards, e.g. the 24h max-duration check, still apply).
 *
 * If close_time <= open_time (overnight library hours, e.g. 18:00–02:00),
 * the operating-hours check is skipped — overnight windows aren't modeled
 * by the current schema and would need a dedicated migration to handle
 * correctly.
 */
export function validateOperatingHours(
  startTime: string,
  endTime:   string,
  openTime:  string,
  closeTime: string,
): ValidationResult {
  const openMin  = timeToMinutes(openTime)
  const closeMin = timeToMinutes(closeTime)

  // Overnight operating windows aren't modeled — skip rather than
  // produce a false rejection.
  if (closeMin <= openMin) return { ok: true }

  const sameDay = getISTDateKey(startTime) === getISTDateKey(endTime)
  if (!sameDay) return { ok: true }

  const startMin = getISTMinutesOfDay(startTime)
  const endMin   = getISTMinutesOfDay(endTime)

  if (startMin < openMin || endMin > closeMin) {
    const fmt = (t: string) => t.slice(0, 5)
    return {
      ok: false,
      error: `Booking must be within library operating hours (${fmt(openTime)}–${fmt(closeTime)})`,
    }
  }

  return { ok: true }
}

/**
 * Ensures the booking's start time has not already passed.
 * `graceMinutes` allows a small buffer (e.g. 5 minutes) for clock skew /
 * the time it takes to complete a payment flow.
 */
export function validateStartNotInPast(
  startTime:    string,
  graceMinutes = 0,
): ValidationResult {
  const startMs = new Date(startTime + '+05:30').getTime()
  if (isNaN(startMs)) return { ok: false, error: 'Invalid start time' }

  if (startMs < Date.now() - graceMinutes * 60_000) {
    return { ok: false, error: 'Booking start time cannot be in the past' }
  }
  return { ok: true }
}

/**
 * Combined entry-point used by all three booking flows.
 * Runs both checks and returns the first failure, if any.
 */
export function validateBookingWindow(params: {
  startTime:     string
  endTime:       string
  openTime:      string
  closeTime:     string
  graceMinutes?: number
}): ValidationResult {
  const pastCheck = validateStartNotInPast(params.startTime, params.graceMinutes ?? 0)
  if (pastCheck.ok === false) return pastCheck

  return validateOperatingHours(params.startTime, params.endTime, params.openTime, params.closeTime)
}