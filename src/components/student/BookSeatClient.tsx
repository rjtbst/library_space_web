// components/student/BookSeatClient.tsx
'use client'

/**
 * Complete three-step student booking flow.
 *
 * Step 1 — Pick a slot + set start/end time (live price preview).
 * Step 2 — Choose a seat from the real SeatGrid (fetched after Step 1).
 * Step 3 — Confirm summary → Razorpay checkout → confirmBookingPayment.
 *
 * FIX (midnight-closing slots): a slot ending at midnight is stored as
 * "00:00", which timeToMinutes() reads as 0 — not 1440. Every previous
 * version of this file called timeToMinutes(slot.end) directly, so a slot
 * like 09:00–00:00 ("open till midnight") was treated as ending at minute 0
 * of the SAME day, making every time after 00:00 (including the entire
 * evening) appear to be "past the slot end" and disabling those times in
 * the <input type="time"> max attribute and in validateTimes(). This file
 * introduces effectiveSlotEndMinutes(), which treats a slot end of exactly
 * "00:00" as 1440 (i.e. end-of-day / midnight), and uses it everywhere a
 * slot boundary comparison happens — both for validation and for the time
 * input min/max attributes that the browser uses to restrict picking.
 *
 * All server actions called here are the EXISTING ones from
 * lib/actions/student.ts — no new actions were added:
 *   • getBookingPricePreview  — live ₹ preview while user picks time
 *   • getSeatAvailability      — seats for chosen window (Step 2)
 *   • initiateBooking          — creates HELD booking + Razorpay order
 *   • confirmBookingPayment    — verifies signature → confirms booking
 *
 * Time convention: all inputs to server actions are plain IST strings
 * ("YYYY-MM-DDTHH:mm") as expected by inputToDB() in student.ts.
 *
 * Props are supplied by the server page at
 * app/(student)/library/[id]/book/seat/page.tsx.
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
 * Slot end, in minutes-since-midnight, treating "00:00" as END OF DAY
 * (1440) rather than the start of the day. A slot stored as
 * { start: "09:00", end: "00:00" } means "9 AM to midnight" (15 hours),
 * not "9 AM to 9 AM" or an inverted/zero-length range.
 *
 * Only "00:00" exactly is treated this way — a slot that genuinely starts
 * AND ends at midnight (zero-length) would be rejected by slot validation
 * on the owner side already, so this never collides with a legitimate
 * same-time slot.
 */
function effectiveSlotEndMinutes(slot: SlotConfig): number {
  const endMins = timeToMinutes(slot.end)
  return endMins === 0 ? 1440 : endMins
}

/** Minutes since midnight → "HH:MM", clamped to 23:59 for display in <input type="time"> (which can't represent 24:00). */
function minsToTimeInput(mins: number): string {
  const clamped = Math.min(mins, 23 * 60 + 59)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

  /* ── Step 3 state ── */
  const [step3Error, setStep3Error]     = useState<string>('')
  const [payLoading, setPayLoading]     = useState(false)

  /* ── Derived ── */
  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null
  const effectiveRate = selectedSlot ? effectiveSlotRate(selectedSlot) : 0
  const selectedSeat  = seats.find((s) => s.id === selectedSeatId) ?? null

  // Slot boundaries in minutes — using effectiveSlotEndMinutes so a slot
  // ending at "00:00" (midnight) is treated as minute 1440, not minute 0.
  const slotStartMins = selectedSlot ? timeToMinutes(selectedSlot.start) : 0
  const slotEndMins   = selectedSlot ? effectiveSlotEndMinutes(selectedSlot) : 24 * 60

  /* ─── Initialise start/end from slot defaults when slot changes ─── */
  useEffect(() => {
    if (!selectedSlot) return
    // Default start = now if today + inside the slot, else slot start.
    // Default end = start + 2h, capped at slot end.
    const nowIST = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
    const nowDate = nowIST.slice(0, 10)
    const nowMins = (() => {
      const [, time] = nowIST.split(' ')
      const [h, m] = time.split(':').map(Number)
      return h * 60 + m
    })()

    let defaultStartMins = slotStartMins
    if (selectedDate === nowDate && nowMins > slotStartMins && nowMins < slotEndMins) {
      // Round up to next 5-minute mark so the default isn't already "in the past" by the time they submit
      defaultStartMins = Math.ceil(nowMins / 5) * 5
    }

    const defaultEndMins = Math.min(defaultStartMins + 120, slotEndMins)

    setStartTime(minsToTimeInput(defaultStartMins))
    setEndTime(minsToTimeInput(defaultEndMins))
    setStep1Error('')
    setPricePreview(null)
  }, [selectedSlotId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const slotEnd    = effectiveSlotEndMinutes(slot)

    // If the picker's "end" is exactly "00:00" the user means midnight
    // (end of day), since <input type="time"> can't represent 24:00.
    if (endMins === 0) endMins = 1440

    if (endMins <= startMins)     return 'End time must be after start time'
    if (endMins - startMins < 30) return 'Minimum booking duration is 30 minutes'
    if (startMins < slotStart)    return `Start time must be on or after ${formatTime12h(slot.start)} for this slot`
    if (endMins   > slotEnd)      return `Booking must end by ${slotEnd === 1440 ? '12:00 AM' : formatTime12h(slot.end)} for this slot`

    // Past-time check (5-min grace same as server)
    const startIST = `${date}T${start}`
    const startMs  = new Date(startIST + '+05:30').getTime()
    if (startMs < Date.now() - 5 * 60_000) return 'Start time cannot be in the past'
    return ''
  }, [])

  /* ─── Live price preview (debounced) ─── */
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
      // If end is "00:00" it means midnight — push the date forward a day
      // for the server call so end_time > start_time, matching how the
      // server's own validateBooking/findContainingSlot treats same-day
      // ranges (the slot's day-of-week is keyed off the START time).
      const endMins = timeToMinutes(end)
      const endDateForServer = endMins === 0
        ? new Date(new Date(date + 'T00:00:00+05:30').getTime() + 86_400_000)
            .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10)
        : date

      const startIST = `${date}T${start}`
      const endIST   = `${endDateForServer}T${end}`
      const res = await getBookingPricePreview(library.id, startIST, endIST)
      setPreviewLoading(false)
      if (res.success === false) {
        setStep1Error(res.error)
        setPricePreview(null)
      } else {
        setPricePreview({ amount: res.data.amount, hourlyRate: res.data.hourlyRate })
        setStep1Error('')
      }
    }, 600)
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

  /** Resolve the "YYYY-MM-DDTHH:mm" pair to send to the server, handling the midnight-end edge case. */
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

    // Fetch real seat availability for the EXACT chosen window
    setSeatsLoading(true)
    const { startIST, endIST } = resolveServerRange()
    getSeatAvailability(library.id, startIST, endIST).then((data) => {
      setSeats(data)
      setSeatsLoading(false)
    })
  }

  /* ─── Step 2 → Step 3 ─── */
  function goToStep3() {
    if (!selectedSeatId) { setStep2Error('Please select a seat'); return }
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
      // 1. Initiate booking (creates HELD booking + Razorpay order)
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

      const { bookingId, amount, razorpayOrderId, razorpayKeyId, libraryName } = initRes.data

      // 2. Open Razorpay checkout
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
          // 3. Confirm on server
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

          // 4. Navigate to confirmation page
          router.push(`/library/${library.id}/book/confirm?booking=${bookingId}`)
        },
        onDismiss: () => {
          setPayLoading(false)
        },
        onError: (errMsg) => {
          setStep3Error(errMsg)
          setPayLoading(false)
        },
      })
    })
  }

  /* ─── Back navigation ─── */
  function handleBack() {
    if (step === 1) router.push(`/library/${library.id}`)
    else if (step === 2) { setStep(1); setStep1Error('') }
    else if (step === 3) { setStep(2); setStep3Error('') }
  }

  /* ─── Duration in hours (display) ─── */
  const durationH = startTime && endTime
    ? (() => {
        const sm = timeToMinutes(startTime)
        let em = timeToMinutes(endTime)
        if (em === 0) em = 1440 // midnight-end
        return (em - sm) / 60
      })()
    : 0

  /* ─── Today string for date min ─── */
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

      {/* ────────────────────── STEP 1: Slot & Time ────────────────────── */}
      {step === 1 && (
        <div className="flex-1 px-4 py-5 space-y-5 max-w-lg mx-auto w-full">

          {/* Slot cards */}
          <div>
            <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest mb-3">
              Select a time slot
            </p>
            <div className="space-y-2">
              {slots.map((slot) => {
                const rate    = effectiveSlotRate(slot)
                const active  = slot.id === selectedSlotId
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
              <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                <Calendar className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">Date</span>
                <input
                  type="date"
                  value={selectedDate}
                  min={today}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="flex-1 text-[13px] font-medium text-[#0D1117] bg-transparent outline-none"
                />
              </label>

              {/* Start time — min/max use slotStartMins/slotEndMins (midnight-aware) */}
              <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                <Clock className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">Start</span>
                <input
                  type="time"
                  value={startTime}
                  min={selectedSlot ? selectedSlot.start : '00:00'}
                  max={selectedSlot ? minsToTimeInput(slotEndMins - 30) : '23:30'}
                  onChange={(e) => handleStartChange(e.target.value)}
                  className="flex-1 text-[13px] font-medium text-[#0D1117] bg-transparent outline-none"
                />
                {selectedSlot && (
                  <span className="text-[10px] text-[#9AACBE] flex-shrink-0">
                    from {formatTime12h(selectedSlot.start)}
                  </span>
                )}
              </label>

              {/* End time — min/max use slotStartMins/slotEndMins (midnight-aware);
                  note the <input type="time"> can't natively represent "24:00", so
                  a slot ending at midnight shows max="23:59" here and we treat a
                  literal "00:00" end value as midnight in validateTimes/resolveServerRange. */}
              <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                <Clock className="w-4 h-4 text-[#9AACBE] flex-shrink-0" />
                <span className="text-[12px] text-[#9AACBE] w-14 flex-shrink-0">End</span>
                <input
                  type="time"
                  value={endTime}
                  min={startTime ? minsToTimeInput(timeToMinutes(startTime) + 30) : (selectedSlot?.start ?? '00:30')}
                  max={slotEndMins === 1440 ? '23:59' : minsToTimeInput(slotEndMins)}
                  onChange={(e) => handleEndChange(e.target.value)}
                  className="flex-1 text-[13px] font-medium text-[#0D1117] bg-transparent outline-none"
                />
                {selectedSlot && (
                  <span className="text-[10px] text-[#9AACBE] flex-shrink-0">
                    by {slotEndMins === 1440 ? '12:00 AM' : formatTime12h(selectedSlot.end)}
                  </span>
                )}
              </label>
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
                  ? <div className="mt-1 h-5 w-24 rounded-md bg-[#DDE4EE] animate-pulse" />
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
            disabled={!!step1Error || !pricePreview || previewLoading}
            className="w-full py-3.5 rounded-xl bg-[#1E5CFF] text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(30,92,255,.3)] hover:bg-[#1447D4] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Check Seat Availability
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ────────────────────── STEP 2: Pick Seat ────────────────────── */}
      {step === 2 && (
        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-4">

          {/* Time summary pill */}
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
            <ErrorBox msg="All seats are booked for this exact time window. Try a different time." />
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

      {/* ────────────────────── STEP 3: Confirm & Pay ────────────────────── */}
      {step === 3 && (
        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-4">

          <p className="text-[11px] font-semibold text-[#9AACBE] uppercase tracking-widest">
            Booking summary
          </p>

          {/* Summary card */}
          <div className="bg-white border border-[#DDE4EE] rounded-xl overflow-hidden divide-y divide-[#F0F4F8]">
            {[
              { icon: MapPin,    label: 'Library', value: `${library.name}` },
              { icon: MapPin,    label: 'Address', value: `${library.area}, ${library.city}` },
              { icon: Armchair,  label: 'Seat',    value: selectedSeat?.label ?? '—' },
              { icon: Calendar,  label: 'Date',    value: fmtDate(`${selectedDate}T${startTime}`) },
              { icon: Clock,     label: 'Time',    value: `${fmt12h(startTime)} – ${timeToMinutes(endTime) === 0 ? '12:00 AM' : fmt12h(endTime)}` },
              { icon: Clock,     label: 'Duration',value: `${durationH.toFixed(1)} hrs` },
              { icon: Tag,       label: 'Slot rate',value: `₹${effectiveRate}/hr` },
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