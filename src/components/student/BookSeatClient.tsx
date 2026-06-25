// components/student/BookSeatClient.tsx
'use client'

/**
 * Three-step student booking flow.
 *
 * Step 1 — Pick a slot + set start/end time (live price preview).
 * Step 2 — Choose a seat from the real SeatGrid (live realtime, auto-refreshes
 *           when any booking changes for this library).
 * Step 3 — Confirm summary → Razorpay checkout → confirmBookingPayment.
 *
 * Key fixes in this version:
 *
 * 1. AM/PM TIME PICKER — replaced <input type="time"> (renders 24h on many
 *    Indian Android devices) with a custom Hour / Minute / AM-PM select trio.
 *    All values are converted to/from "HH:MM" for internal state so nothing
 *    downstream changes.
 *
 * 2. DEFAULT TIME GUARD — if the current time is so close to slot end that
 *    start + 2h would overflow (producing a < 30 min window that immediately
 *    fails validation), we back up the start so the default window is always
 *    at least 1 hour and ends on or before the slot boundary.
 *
 * 3. REALTIME SEAT REFRESH — while the student is on Step 2, a Supabase
 *    realtime subscription re-fetches seat availability whenever any booking
 *    changes for this library. This prevents selecting a seat that was just
 *    taken by another student.
 *
 * 4. CLEAR ERROR MESSAGES — all validation errors are shown inline next to
 *    the relevant field, not only at the bottom. The CTA shows a loading
 *    state while the price preview is calculating.
 *
 * 5. MIDNIGHT-CLOSING SLOTS — a slot stored as end "00:00" means midnight
 *    (end of day). effectiveSlotEndMinutes() treats it as 1440 everywhere.
 */

import { useState, useCallback, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Clock,
  Calendar,
  MapPin,
  AlertCircle,
  Loader2,
  Tag,
  CreditCard,
  Armchair,
} from 'lucide-react'
import SeatGrid from './SeatGrid'
import { useRazorpay } from '@/hooks/userazorpay'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import {
  getBookingPricePreview,
  getSeatAvailability,
  initiateBooking,
  confirmBookingPayment,
  type SeatAvailability,
  type StudentProfile,
} from '@/lib/actions/student'
import {
  type SlotConfig,
  daysDisplay,
  effectiveSlotRate,
  formatTime12h,
  timeToMinutes,
} from '@/lib/booking/types'
import { type LibraryStatus } from '@/lib/booking/libraryStatus'

/* ─────────────────────────────────────────────────────────────────────────
   Prop types
───────────────────────────────────────────────────────────────────────── */

interface LibrarySummary {
  id:        string
  name:      string
  city:      string
  area:      string
  address:   string
  rating:    number
  cover_url: string | null
  freeSeats: number
  status:    LibraryStatus
}

interface Props {
  library:             LibrarySummary
  slots:               SlotConfig[]         // active slots only
  profile:             StudentProfile | null
  preselectedSlotId:   string | null
}

/* ─────────────────────────────────────────────────────────────────────────
   Local helpers
───────────────────────────────────────────────────────────────────────── */

/** Format "HH:MM" (24h) → "9:00 AM" */
function fmt12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number)
  const a      = h >= 12 ? 'PM' : 'AM'
  const h12    = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${a}`
}

/** "YYYY-MM-DDTHH:mm" → "Mon, 16 Jun 2025" */
function fmtDate(val: string): string {
  const datePart = val.slice(0, 10)
  try {
    return new Date(datePart + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
  } catch {
    return datePart
  }
}

/** Today's date in IST as "YYYY-MM-DD" */
function todayIST(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
}

/**
 * Slot end in minutes-since-midnight, treating "00:00" as END OF DAY (1440).
 * A slot stored as { start: "09:00", end: "00:00" } means "9 AM to midnight".
 */
function effectiveSlotEndMinutes(slot: SlotConfig): number {
  const endMins = timeToMinutes(slot.end)
  return endMins === 0 ? 1440 : endMins
}

/** Minutes → "HH:MM", clamped to 23:59 (can't represent 24:00 in an input). */
function minsToHHMM(mins: number): string {
  const clamped = Math.min(mins, 23 * 60 + 59)
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/* ─────────────────────────────────────────────────────────────────────────
   AM/PM Time Picker
   Renders as Hour (1–12) + free-entry Minute (00–59) + AM/PM.
   Value in/out is "HH:MM" 24h format for compatibility with all other logic.
   Backend validation (slotBoundaryValidation.ts) already accepts any
   minute value — this picker used to artificially restrict input to
   :00/:15/:30/:45 via a <select>. Minute is now a free-typed numeric field
   so a student can pick e.g. 9:07 or 9:41, matching what the server allows.
───────────────────────────────────────────────────────────────────────── */

interface TimePickerProps {
  value:       string          // "HH:MM" 24h
  onChange:    (v: string) => void
  minMins?:    number          // minutes-since-midnight lower bound (inclusive)
  maxMins?:    number          // minutes-since-midnight upper bound (inclusive)
  disabled?:   boolean
  id?:         string
}

function TimePicker({ value, onChange, minMins, maxMins, disabled, id }: TimePickerProps) {
  const totalMins = value ? timeToMinutes(value) : 0
  const h24  = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  const isPM = h24 >= 12
  const h12  = h24 % 12 || 12

  // Local text state for the minute field so the user can freely type/clear
  // digits without each keystroke being clamped mid-edit (e.g. typing "07"
  // shouldn't get force-corrected after the first "0"). Clamping happens
  // onBlur and whenever the value changes from outside (hour/period change).
  const [minuteText, setMinuteText] = useState(String(mins).padStart(2, '0'))
  useEffect(() => {
    setMinuteText(String(mins).padStart(2, '0'))
  }, [mins])

  function emit(newH24: number, newMins: number) {
    onChange(minsToHHMM(newH24 * 60 + newMins))
  }

  function handleHour(h: number) {
    const newH24 = (h % 12) + (isPM ? 12 : 0)
    emit(newH24, mins)
  }

  function commitMinute(raw: string) {
    const parsed = parseInt(raw, 10)
    const clamped = isNaN(parsed) ? 0 : Math.min(59, Math.max(0, parsed))
    emit(h24, clamped)
    setMinuteText(String(clamped).padStart(2, '0'))
  }

  function handlePeriod(period: 'AM' | 'PM') {
    const newH24 = (h12 % 12) + (period === 'PM' ? 12 : 0)
    emit(newH24, mins)
  }

  const selStyle = [
    'bg-white border border-[#DDE4EE] rounded-lg px-2 py-2 text-[13px] font-semibold',
    'text-[#0D1117] outline-none focus:border-[#1E5CFF] transition-colors',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ')

  const minuteInputStyle = [
    'bg-white border border-[#DDE4EE] rounded-lg px-2 py-2 text-[13px] font-semibold',
    'text-[#0D1117] outline-none focus:border-[#1E5CFF] transition-colors',
    'w-[44px] text-center tabular-nums',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
  ].join(' ')

  // Determine which hour options are within min/max bounds
  function isHourDisabled(h: number) {
    if (minMins === undefined && maxMins === undefined) return false
    const h24test = (h % 12) + (isPM ? 12 : 0)
    const loMins  = h24test * 60
    const hiMins  = h24test * 60 + 59
    if (minMins !== undefined && hiMins < minMins) return true
    if (maxMins !== undefined && loMins > maxMins) return true
    return false
  }

  return (
    <div className="flex items-center gap-1.5" id={id}>
      {/* Hour */}
      <select
        value={h12}
        disabled={disabled}
        onChange={e => handleHour(Number(e.target.value))}
        className={selStyle}
        aria-label="Hour"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
          <option key={h} value={h} disabled={isHourDisabled(h)}>
            {h}
          </option>
        ))}
      </select>

      <span className="text-[#9AACBE] font-bold text-[13px]">:</span>

      {/* Minute — free entry 00-59, not restricted to quarter-hours */}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={minuteText}
        disabled={disabled}
        onChange={e => {
          const digitsOnly = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
          setMinuteText(digitsOnly)
          // Live-commit once we have a plausible value so price preview /
          // validation react as the user types, without fighting the
          // cursor on a single-digit intermediate state like "0".
          if (digitsOnly !== '' && Number(digitsOnly) <= 59) {
            emit(h24, Number(digitsOnly))
          }
        }}
        onBlur={e => commitMinute(e.target.value)}
        className={minuteInputStyle}
        aria-label="Minute (0-59)"
      />

      {/* AM / PM */}
      <select
        value={isPM ? 'PM' : 'AM'}
        disabled={disabled}
        onChange={e => handlePeriod(e.target.value as 'AM' | 'PM')}
        className={selStyle}
        aria-label="AM or PM"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Step indicator
───────────────────────────────────────────────────────────────────────── */

const STEP_LABELS = ['Slot & Time', 'Pick Seat', 'Confirm & Pay'] as const

function StepBar({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center px-4 py-3 bg-white border-b border-[#E4EAF2]">
      {STEP_LABELS.map((label, idx) => {
        const step = (idx + 1) as 1 | 2 | 3
        const done   = step < current
        const active = step === current
        return (
          <div key={step} className="flex items-center" style={{ flex: step < 3 ? 1 : undefined }}>
            <div className="flex items-center gap-1.5">
              <div
                className={[
                  'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all',
                  done   ? 'bg-[#1E5CFF] text-white'
                  : active ? 'bg-[#1E5CFF] text-white shadow-[0_0_0_3px_rgba(30,92,255,0.2)]'
                  : 'bg-[#F4F7FB] text-[#9AACBE] border border-[#DDE4EE]',
                ].join(' ')}
              >
                {done ? <CheckCircle className="w-3.5 h-3.5" /> : step}
              </div>
              <span
                className={[
                  'text-[11px] font-medium whitespace-nowrap',
                  active ? 'text-[#1E5CFF]' : done ? 'text-[#6E7F94]' : 'text-[#9AACBE]',
                ].join(' ')}
              >
                {label}
              </span>
            </div>
            {step < 3 && (
              <div
                className={[
                  'flex-1 h-px mx-2 transition-colors',
                  done ? 'bg-[#1E5CFF]' : 'bg-[#E4EAF2]',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Error box
───────────────────────────────────────────────────────────────────────── */

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 bg-[#FFF0F0] border border-[#FCA5A5] rounded-xl px-3 py-2.5 text-[12px] text-[#C5282C]">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────────────────── */

export default function BookSeatClient({
  library,
  slots,
  profile,
  preselectedSlotId,
}: Props) {
  const router = useRouter()
  const { openCheckout } = useRazorpay()
  const [isPending, startTransition] = useTransition()

  /* ── Wizard state ── */
  const [step, setStep] = useState<1 | 2 | 3>(1)

  /* ── Step 1 state ── */
  const [selectedSlotId, setSelectedSlotId] = useState<string>(
    preselectedSlotId ?? slots[0]?.id ?? '',
  )
  const [selectedDate, setSelectedDate]   = useState<string>(todayIST())
  const [startTime, setStartTime]         = useState<string>('')   // "HH:MM"
  const [endTime, setEndTime]             = useState<string>('')   // "HH:MM"
  const [pricePreview, setPricePreview]   = useState<{ amount: number; hourlyRate: number } | null>(null)
  const [step1Error, setStep1Error]       = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  /* ── Step 2 state ── */
  const [seats, setSeats]               = useState<SeatAvailability[]>([])
  const [seatsLoading, setSeatsLoading] = useState(false)
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)
  const [step2Error, setStep2Error]     = useState<string>('')
  // Track the range for realtime re-fetch
  const step2RangeRef = useRef<{ startIST: string; endIST: string } | null>(null)

  /* ── Step 3 state ── */
  const [step3Error, setStep3Error]     = useState<string>('')
  const [payLoading, setPayLoading]     = useState(false)

  /* ── Derived ── */
  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null
  const effectiveRate = selectedSlot ? effectiveSlotRate(selectedSlot) : 0
  const selectedSeat  = seats.find((s) => s.id === selectedSeatId) ?? null

  // Slot boundaries in minutes — midnight-aware
  const slotStartMins = selectedSlot ? timeToMinutes(selectedSlot.start) : 0
  const slotEndMins   = selectedSlot ? effectiveSlotEndMinutes(selectedSlot) : 24 * 60

  /* ─── Initialise start/end from slot defaults when slot changes ─── */
  useEffect(() => {
    if (!selectedSlot) return

    const nowIST  = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    const nowDate = nowIST.slice(0, 10)
    const nowMins = (() => {
      const [, time] = nowIST.split(' ')
      const [h, m]   = time.split(':').map(Number)
      return h * 60 + m
    })()

    // Default start: now (rounded up to next 15 min) if we're inside the slot today,
    // otherwise slot start
    let defaultStartMins = slotStartMins
    if (selectedDate === nowDate && nowMins > slotStartMins && nowMins < slotEndMins) {
      defaultStartMins = Math.ceil(nowMins / 15) * 15
    }

    // Default end: start + 2h, capped at slot end
    let defaultEndMins = Math.min(defaultStartMins + 120, slotEndMins)

    // Guard: if the resulting window is < 60 min (e.g. we're near slot end),
    // back up start so user has at least a 60-min default window to work with.
    // validateTimes() requires 30 min minimum; 60 min gives comfortable headroom.
    if (defaultEndMins - defaultStartMins < 60) {
      defaultStartMins = Math.max(slotStartMins, defaultEndMins - 60)
    }

    // Final guard: if STILL can't fit 30 min (tiny slot), use slot boundaries
    if (defaultEndMins - defaultStartMins < 30) {
      defaultStartMins = slotStartMins
      defaultEndMins   = slotEndMins
    }

    const newStart = minsToHHMM(defaultStartMins)
    const newEnd   = minsToHHMM(defaultEndMins)

    setStartTime(newStart)
    setEndTime(newEnd)
    setStep1Error('')
    setPricePreview(null)

    // Auto-trigger price preview with default times so the CTA is ready on first load
    // Use setTimeout(0) to run after the state updates are batched and committed
    setTimeout(() => {
      refreshPreview(selectedSlot, selectedDate, newStart, newEnd)
    }, 0)
  }, [selectedSlotId, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Realtime: re-fetch seats while on Step 2 ─── */
  useEffect(() => {
    if (step !== 2) return

    const supabase = createBrowserSupabaseClient()
    const channel  = supabase
      .channel(`book-seat-avail-${library.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `library_id=eq.${library.id}` },
        () => {
          const range = step2RangeRef.current
          if (!range) return
          // Re-fetch availability so a seat just taken by someone else goes red
          getSeatAvailability(library.id, range.startIST, range.endIST).then((fresh) => {
            setSeats(fresh)
            // If the seat the student selected was just taken, deselect it
            // and show a clear message so they pick another one
            setSelectedSeatId((prev) => {
              if (!prev) return null
              const stillAvail = fresh.find((s) => s.id === prev)?.is_available
              if (!stillAvail) {
                setStep2Error('Your selected seat was just taken. Please choose another seat.')
                return null
              }
              return prev
            })
          })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [step, library.id])

  /* ─── Client-side time validation ─── */
  const validateTimes = useCallback((
    slot: SlotConfig | null,
    date: string,
    start: string,
    end: string,
  ): string => {
    if (!slot) return 'Please select a slot'
    if (!start || !end) return 'Please set both start and end time'

    const startMins = timeToMinutes(start)
    let   endMins   = timeToMinutes(end)
    const slotStart = timeToMinutes(slot.start)
    const slotEnd   = effectiveSlotEndMinutes(slot)

    // "00:00" from the picker means midnight (end of day)
    if (endMins === 0) endMins = 1440

    if (endMins <= startMins)     return 'End time must be after start time'
    if (endMins - startMins < 30) return 'Minimum booking is 30 minutes'
    if (startMins < slotStart)    return `Start must be at or after ${formatTime12h(slot.start)} for this slot`
    if (endMins   > slotEnd)      return `Booking must end by ${slotEnd === 1440 ? '12:00 AM' : formatTime12h(slot.end)}`

    // 5-min grace window so a booking for "right now" still works
    const startMs = new Date(`${date}T${start}+05:30`).getTime()
    if (startMs < Date.now() - 5 * 60_000) return 'Start time cannot be in the past'
    return ''
  }, [])

  /* ─── Live price preview (debounced 500ms) ─── */
  const previewTimer = useRef<ReturnType<typeof setTimeout>>()

  const refreshPreview = useCallback((
    slot: SlotConfig | null,
    date: string,
    start: string,
    end: string,
  ) => {
    clearTimeout(previewTimer.current)
    const err = validateTimes(slot, date, start, end)
    setStep1Error(err)
    if (err) { setPricePreview(null); return }

    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true)
      const endMins = timeToMinutes(end)
      const endDateForServer = endMins === 0
        ? new Date(new Date(date + 'T00:00:00+05:30').getTime() + 86_400_000)
            .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
        : date
      const res = await getBookingPricePreview(library.id, `${date}T${start}`, `${endDateForServer}T${end}`)
      setPreviewLoading(false)
      if (res.success === false) {
        setStep1Error(res.error)
        setPricePreview(null)
      } else {
        setPricePreview({ amount: res.data.amount, hourlyRate: res.data.hourlyRate })
        setStep1Error('')
      }
    }, 500)
  }, [library.id, validateTimes])

  /* ─── Handlers ─── */

  function handleSlotSelect(id: string) {
    setSelectedSlotId(id)
    // useEffect above resets start/end/preview
  }

  function handleStartChange(val: string) {
    setStartTime(val)
    refreshPreview(selectedSlot, selectedDate, val, endTime)
  }

  function handleEndChange(val: string) {
    setEndTime(val)
    refreshPreview(selectedSlot, selectedDate, startTime, val)
  }

  function handleDateChange(val: string) {
    setSelectedDate(val)
    refreshPreview(selectedSlot, val, startTime, endTime)
  }

  /** Build the IST range strings for server actions, handling midnight end. */
  function resolveServerRange(): { startIST: string; endIST: string } {
    const endMins = timeToMinutes(endTime)
    const endDateForServer = endMins === 0
      ? new Date(new Date(selectedDate + 'T00:00:00+05:30').getTime() + 86_400_000)
          .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
      : selectedDate
    return {
      startIST: `${selectedDate}T${startTime}`,
      endIST:   `${endDateForServer}T${endTime}`,
    }
  }

  /* ─── Step 1 → Step 2 ─── */
  function goToStep2() {
    const err = validateTimes(selectedSlot, selectedDate, startTime, endTime)
    if (err) { setStep1Error(err); return }
    setSelectedSeatId(null)
    setStep2Error('')
    setStep(2)

    const range = resolveServerRange()
    step2RangeRef.current = range   // used by realtime handler

    setSeatsLoading(true)
    getSeatAvailability(library.id, range.startIST, range.endIST).then((data) => {
      setSeats(data)
      setSeatsLoading(false)
    })
  }

  /* ─── Step 2 → Step 3 ─── */
  function goToStep3() {
    if (!selectedSeatId) { setStep2Error('Please select a seat to continue'); return }
    setStep3Error('')
    setStep(3)
  }

  /* ─── Step 3: Pay ─── */
  function handlePay() {
    if (!selectedSeatId || !selectedSlot || !pricePreview) return
    setPayLoading(true)
    setStep3Error('')

    const { startIST, endIST } = resolveServerRange()

    startTransition(async () => {
      const initRes = await initiateBooking({
        libraryId: library.id,
        seatId:    selectedSeatId,
        startTime: startIST,
        endTime:   endIST,
      })

      if (initRes.success === false) {
        setStep3Error(initRes.error)
        setPayLoading(false)
        return
      }

      const { bookingId, amount, razorpayOrderId, razorpayKeyId, libraryName, testMode } = initRes.data

      // ── TEST_MODE: skip Razorpay, confirm directly with synthetic IDs ──
      if (testMode) {
        console.log('[TEST_MODE] Bypassing Razorpay checkout, confirming booking directly')
        const confirmRes = await confirmBookingPayment({
          bookingId,
          razorpayOrderId:   razorpayOrderId,
          razorpayPaymentId: `test_pay_${Date.now()}`,
          razorpaySignature: 'test_signature_bypass',
        })
        if (confirmRes.success === false) {
          setStep3Error(confirmRes.error)
          setPayLoading(false)
          return
        }
        router.push(`/library/${library.id}/book/confirm?booking=${bookingId}`)
        return
      }

      openCheckout({
        orderId:     razorpayOrderId,
        keyId:       razorpayKeyId,
        amount,
        name:        libraryName,
        description: `Seat ${selectedSeat?.label ?? ''} · ${fmt12h(startTime)}–${fmt12h(endTime)}`,
        prefill: {
          name:  profile?.full_name ?? profile?.name ?? '',
          email: profile?.email ?? '',
          phone: profile?.phone ?? '',
        },
        onSuccess: async (paymentId, orderId, signature) => {
          const confirmRes = await confirmBookingPayment({
            bookingId,
            razorpayOrderId:   orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
          })

          if (confirmRes.success === false) {
            setStep3Error(confirmRes.error)
            setPayLoading(false)
            return
          }

          router.push(`/library/${library.id}/book/confirm?booking=${bookingId}`)
        },
        onDismiss: () => { setPayLoading(false) },
        onError:   (errMsg) => { setStep3Error(errMsg); setPayLoading(false) },
      })
    })
  }

  /* ─── Back navigation ─── */
  function handleBack() {
    if (step === 1) router.push(`/library/${library.id}`)
    else if (step === 2) { setStep(1); setStep1Error('') }
    else if (step === 3) { setStep(2); setStep3Error('') }
  }

  /* ─── Duration display ─── */
  const durationH = startTime && endTime
    ? (() => {
        const sm = timeToMinutes(startTime)
        let em   = timeToMinutes(endTime)
        if (em === 0) em = 1440
        return (em - sm) / 60
      })()
    : 0

  const today = todayIST()

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[#F4F7FB] flex flex-col">

      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white border-b border-[#E4EAF2] shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={handleBack}
            className="w-8 h-8 rounded-lg border border-[#DDE4EE] flex items-center justify-center text-[#6E7F94] hover:bg-[#F4F7FB] transition-colors flex-shrink-0"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-[#0D1117] truncate">{library.name}</div>
            <div className="text-[11px] text-[#9AACBE] truncate">
              {library.area}, {library.city}
            </div>
          </div>
          <span
            className={[
              'text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0',
              library.status.isOpen
                ? 'bg-[#E2F5EE] text-[#0D7C54]'
                : 'bg-[#FEE2E2] text-[#C5282C]',
            ].join(' ')}
          >
            {library.status.isOpen ? 'Open' : 'Closed'}
          </span>
        </div>
        <StepBar current={step} />
      </div>

      {/* ─────────────────── STEP 1: Slot & Time ─────────────────── */}
      {step === 1 && (
        <div className="flex-1 px-4 py-5 space-y-5 max-w-lg mx-auto w-full">

          {/* Slot cards */}
          <div>
            <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest mb-3">
              Select a time slot
            </p>
            <div className="space-y-2">
              {slots.map((slot) => {
                const rate     = effectiveSlotRate(slot)
                const active   = slot.id === selectedSlotId
                const endLabel = effectiveSlotEndMinutes(slot) === 1440 ? '12:00 AM' : formatTime12h(slot.end)
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => handleSlotSelect(slot.id)}
                    className={[
                      'w-full flex items-center justify-between rounded-xl border px-4 py-3.5 text-left transition-all',
                      active
                        ? 'border-[#1E5CFF] bg-[rgba(30,92,255,0.05)] shadow-[0_0_0_1px_#1E5CFF]'
                        : 'border-[#DDE4EE] bg-white hover:border-[#1E5CFF]',
                    ].join(' ')}
                  >
                    <div>
                      <div className="text-[13px] font-bold text-[#0D1117]">
                        {formatTime12h(slot.start)} – {endLabel}
                      </div>
                      <div className="text-[11px] text-[#9AACBE] mt-0.5">
                        {daysDisplay(slot.days)}
                        {slot.discount > 0 && (
                          <span className="ml-2 text-[#0D7C54] font-medium">
                            ₹{slot.discount}/hr off
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      {slot.discount > 0 && (
                        <div className="text-[10px] text-[#9AACBE] line-through">
                          ₹{slot.price}/hr
                        </div>
                      )}
                      <div className="text-[17px] font-bold text-[#1E5CFF]">₹{rate}</div>
                      <div className="text-[10px] text-[#9AACBE]">/hr</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date + time pickers */}
          <div>
            <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest mb-3">
              Choose your time
            </p>
            <div className="bg-white border border-[#DDE4EE] rounded-xl overflow-hidden divide-y divide-[#F0F4F8]">

              {/* Date */}
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">Date</span>
                <input
                  type="date"
                  value={selectedDate}
                  min={today}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="flex-1 text-[13px] font-medium text-[#0D1117] bg-transparent outline-none cursor-pointer"
                />
              </div>

              {/* Start time */}
              <div className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
                <Clock className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">Start</span>
                <div className="flex-1">
                  <TimePicker
                    value={startTime}
                    onChange={handleStartChange}
                    minMins={slotStartMins}
                    maxMins={slotEndMins - 30}
                  />
                </div>
                {selectedSlot && (
                  <span className="text-[10px] text-[#9AACBE] flex-shrink-0 ml-auto sm:ml-0">
                    from {formatTime12h(selectedSlot.start)}
                  </span>
                )}
              </div>

              {/* End time */}
              <div className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
                <Clock className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">End</span>
                <div className="flex-1">
                  <TimePicker
                    value={endTime}
                    onChange={handleEndChange}
                    minMins={startTime ? timeToMinutes(startTime) + 30 : slotStartMins + 30}
                    maxMins={slotEndMins === 1440 ? 1439 : slotEndMins}
                  />
                </div>
                {selectedSlot && (
                  <span className="text-[10px] text-[#9AACBE] flex-shrink-0 ml-auto sm:ml-0">
                    by {slotEndMins === 1440 ? '12:00 AM' : formatTime12h(selectedSlot.end)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {step1Error && <ErrorBox msg={step1Error} />}

          {/* Price preview */}
          {!step1Error && durationH >= 0.5 && (
            <div className="bg-[rgba(30,92,255,0.06)] border border-[rgba(30,92,255,0.18)] rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-[#6E7F94]">Estimated total</div>
                {previewLoading
                  ? <div className="mt-1 h-4 w-32 rounded-md bg-[#DDE4EE] animate-pulse" />
                  : pricePreview
                    ? (
                      <div className="text-[11px] text-[#9AACBE] mt-0.5">
                        {durationH.toFixed(1)} hr × ₹{pricePreview.hourlyRate}/hr
                      </div>
                    )
                    : null
                }
              </div>
              {previewLoading
                ? <Loader2 className="w-5 h-5 text-[#1E5CFF] animate-spin" />
                : pricePreview
                  ? <span className="text-[22px] font-bold text-[#1E5CFF]">₹{pricePreview.amount}</span>
                  : null
              }
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={goToStep2}
            disabled={!!step1Error || !startTime || !endTime || previewLoading || (!pricePreview && !step1Error)}
            className="w-full py-3.5 rounded-xl bg-[#1E5CFF] text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(30,92,255,.3)] hover:bg-[#1447D4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {previewLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Calculating price…</>
              : <>Check Seat Availability <ArrowRight className="w-4 h-4" /></>
            }
          </button>
        </div>
      )}

      {/* ─────────────────── STEP 2: Pick Seat ─────────────────── */}
      {step === 2 && (
        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-4">

          {/* Time summary pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 bg-white border border-[#DDE4EE] rounded-full px-3 py-1 text-[12px] font-medium text-[#3A4A5C]">
              <Calendar className="w-3.5 h-3.5 text-[#9AACBE]" />
              {fmtDate(`${selectedDate}T${startTime}`)}
            </span>
            <span className="inline-flex items-center gap-1.5 bg-white border border-[#DDE4EE] rounded-full px-3 py-1 text-[12px] font-medium text-[#3A4A5C]">
              <Clock className="w-3.5 h-3.5 text-[#9AACBE]" />
              {fmt12h(startTime)} – {timeToMinutes(endTime) === 0 ? '12:00 AM' : fmt12h(endTime)}
            </span>
            {pricePreview && (
              <span className="inline-flex items-center gap-1.5 bg-[rgba(30,92,255,0.08)] border border-[rgba(30,92,255,0.2)] rounded-full px-3 py-1 text-[12px] font-bold text-[#1E5CFF]">
                <Tag className="w-3.5 h-3.5" />
                ₹{pricePreview.amount}
              </span>
            )}
          </div>

          {/* Live update badge */}
          <div className="flex items-center gap-1.5 text-[11px] text-[#0D7C54]">
            <span className="w-2 h-2 rounded-full bg-[#0D7C54] animate-pulse" />
            Seat map updates live — auto-refreshes if someone else books
          </div>

          <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest">
            Select a seat
          </p>

          {/* SeatGrid */}
          <div className="bg-white border border-[#DDE4EE] rounded-xl p-4">
            <SeatGrid
              seats={seats}
              selectedId={selectedSeatId}
              onSelect={(id) => { setSelectedSeatId(id || null); setStep2Error('') }}
              loading={seatsLoading}
            />
          </div>

          {!seatsLoading && seats.length === 0 && (
            <ErrorBox msg="No seats are configured for this library yet. Please contact the library." />
          )}
          {!seatsLoading && seats.length > 0 && seats.every((s) => !s.is_available) && (
            <ErrorBox msg="All seats are booked for this time. Try a different time or date." />
          )}

          {step2Error && <ErrorBox msg={step2Error} />}

          {/* Selected seat summary */}
          {selectedSeat && (
            <div className="bg-[rgba(30,92,255,0.05)] border border-[rgba(30,92,255,0.2)] rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Armchair className="w-4 h-4 text-[#1E5CFF]" />
                <span className="text-[13px] font-bold text-[#0D1117]">
                  Seat {selectedSeat.label} selected
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSeatId(null)}
                className="text-[12px] text-[#1E5CFF] font-semibold hover:underline"
              >
                Change
              </button>
            </div>
          )}

          {/* CTAs */}
          <button
            type="button"
            onClick={goToStep3}
            disabled={!selectedSeatId || seatsLoading}
            className="w-full py-3.5 rounded-xl bg-[#1E5CFF] text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(30,92,255,.3)] hover:bg-[#1447D4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Continue to Payment
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleBack}
            className="w-full py-3 rounded-xl bg-white border border-[#DDE4EE] text-[13px] font-medium text-[#6E7F94] hover:bg-[#F4F7FB] transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {/* ─────────────────── STEP 3: Confirm & Pay ─────────────────── */}
      {step === 3 && (
        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-4">

          <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest">
            Booking summary
          </p>

          {/* Summary card */}
          <div className="bg-white border border-[#DDE4EE] rounded-xl overflow-hidden divide-y divide-[#F0F4F8]">
            {[
              { icon: MapPin,   label: 'Library',  value: library.name },
              { icon: MapPin,   label: 'Address',  value: `${library.area}, ${library.city}` },
              { icon: Armchair, label: 'Seat',     value: selectedSeat?.label ?? '—' },
              { icon: Calendar, label: 'Date',     value: fmtDate(`${selectedDate}T${startTime}`) },
              { icon: Clock,    label: 'Time',     value: `${fmt12h(startTime)} – ${timeToMinutes(endTime) === 0 ? '12:00 AM' : fmt12h(endTime)}` },
              { icon: Clock,    label: 'Duration', value: `${durationH.toFixed(1)} hrs` },
              { icon: Tag,      label: 'Slot rate',value: `₹${effectiveRate}/hr` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3">
                <Icon className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-20 flex-shrink-0">{label}</span>
                <span className="text-[13px] font-semibold text-[#0D1117] flex-1 text-right">{value}</span>
              </div>
            ))}
          </div>

          {/* Price breakdown */}
          <div className="bg-white border border-[#DDE4EE] rounded-xl px-4 py-4 space-y-2">
            <div className="flex justify-between text-[12px] text-[#6E7F94]">
              <span>₹{effectiveRate} × {durationH.toFixed(1)} hr</span>
              <span>₹{pricePreview?.amount ?? '—'}</span>
            </div>
            <div className="flex justify-between text-[12px] text-[#6E7F94]">
              <span>Platform fee</span>
              <span className="text-[#0D7C54] font-semibold">Free</span>
            </div>
            <div className="flex justify-between items-center border-t border-[#F0F4F8] pt-3 mt-2">
              <span className="text-[14px] font-bold text-[#0D1117]">Total</span>
              <span className="text-[22px] font-bold text-[#1E5CFF]">₹{pricePreview?.amount ?? '—'}</span>
            </div>
          </div>

          {/* Trust note */}
          <div className="flex items-center gap-2 text-[11px] text-[#9AACBE]">
            <CreditCard className="w-3.5 h-3.5 flex-shrink-0" />
            Secure payment via Razorpay · UPI, Cards, Net Banking, Wallets
          </div>

          {step3Error && <ErrorBox msg={step3Error} />}

          {/* Pay CTA */}
          <button
            type="button"
            onClick={handlePay}
            disabled={payLoading || isPending || !pricePreview}
            className="w-full py-3.5 rounded-xl bg-[#1E5CFF] text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(30,92,255,.3)] hover:bg-[#1447D4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {payLoading || isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <><CreditCard className="w-4 h-4" /> Pay ₹{pricePreview?.amount ?? '—'}</>
            }
          </button>

          <button
            type="button"
            onClick={handleBack}
            disabled={payLoading || isPending}
            className="w-full py-3 rounded-xl bg-white border border-[#DDE4EE] text-[13px] font-medium text-[#6E7F94] hover:bg-[#F4F7FB] transition-colors disabled:opacity-50"
          >
            Back
          </button>

          <p className="text-center text-[11px] text-[#9AACBE]">
            Your seat is held for 15 minutes after clicking Pay.
          </p>
        </div>
      )}
    </div>
  )
}