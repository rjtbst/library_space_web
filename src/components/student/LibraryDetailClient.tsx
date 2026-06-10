// components/student/LibraryDetailClient.tsx
'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import type { LibraryCard, LibraryBook, StudentProfile, SeatAvailability } from '@/lib/actions/student'
import {
  getSeatAvailability,
  initiateBooking,
  confirmBookingPayment,
  initiatePlanSubscription,
  confirmSubscriptionPayment,
  requestBook,
} from '@/lib/actions/student'
import {
  ChevronLeft, ChevronRight, Star, MapPin, Clock, Navigation2,
  Zap, ArrowRight, CreditCard, BookOpen, CheckCircle2,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { fmtIST } from '@/lib/ist'
import { useRazorpay } from '@/hooks/userazorpay'
import SeatGrid from './SeatGrid'

const AMENITY_ICON: Record<string, string> = {
  WiFi: '📶', AC: '❄️', Parking: '🅿️', Cafeteria: '☕',
  Locker: '🔐', Printing: '🖨️', CCTV: '📹', 'Power Backup': '⚡',
  Washroom: '🚽', 'Quiet Zone': '🔇', 'Power Sockets': '🔌',
}

function fmtTime(raw: string): string {
  const parts = raw.split(':').map(Number)
  const h = parts[0] ?? 0
  const m = parts[1] ?? 0
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function isOpenNow(openRaw: string, closeRaw: string): boolean {
  try {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const now = d.getHours() * 60 + d.getMinutes()
    const parse = (t: string) => {
      const p = t.split(':').map(Number)
      return (p[0] ?? 0) * 60 + (p[1] ?? 0)
    }
    return now >= parse(openRaw) && now < parse(closeRaw)
  } catch { return false }
}

/** Next round hour in IST, clamped between open/close times */
function defaultTimes(openRaw: string, closeRaw: string) {
  const ist  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const oh   = parseInt(openRaw.split(':')[0] ?? '6', 10)
  const ch   = parseInt(closeRaw.split(':')[0] ?? '22', 10)
  const startH = Math.min(Math.max(ist.getHours() + 1, oh), ch - 1)
  const endH   = Math.min(startH + 2, ch)
  const pad    = (n: number) => String(n).padStart(2, '0')
  const date   = `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}`
  return { start: `${date}T${pad(startH)}:00`, end: `${date}T${pad(endH)}:00` }
}

type Tab  = 'book' | 'plans' | 'books'
type Step = 'time' | 'seats'

export default function LibraryDetailClient({
  library, books, profile,
}: {
  library: LibraryCard
  books:   LibraryBook[]
  profile: StudentProfile | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { openCheckout }             = useRazorpay()
  const defaults                     = defaultTimes(library.open_time, library.close_time)

  // Gallery state
  const [imgIdx, setImgIdx] = useState(0)

  // Tab / step
  const [tab,  setTab]  = useState<Tab>('book')
  const [step, setStep] = useState<Step>('time')

  // Time picker
  const [startTime, setStartTime] = useState(defaults.start)
  const [endTime,   setEndTime]   = useState(defaults.end)

  // Seats
  const [seats,        setSeats]        = useState<SeatAvailability[]>([])
  const [loadingSeats, setLoadingSeats] = useState(false)
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null)

  // UI
  const [showAllAmenities, setShowAllAmenities] = useState(false)
  const [requestedBookId,  setRequestedBookId]  = useState<string | null>(null)

  const open = isOpenNow(library.open_time, library.close_time)

  // Computed
  const durationHrs = useMemo(() => {
    try {
      return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000)
    } catch { return 0 }
  }, [startTime, endTime])

  const estimatedCost = Math.ceil(durationHrs * library.base_price)

  // ── Fetch seats ──────────────────────────────────────────────────────────
  async function fetchSeats() {
    if (durationHrs <= 0) { toast.error('Select a valid time range first'); return }
    setLoadingSeats(true)
    setSelectedSeat(null)
    try {
      const data = await getSeatAvailability(library.id, startTime + ':00', endTime + ':00')
      if (!data.length) { toast.error('No seats found for this library'); return }
      setSeats(data)
      setStep('seats')
    } catch {
      toast.error('Failed to load seats. Please try again.')
    } finally {
      setLoadingSeats(false)
    }
  }

  // ── Book seat ─────────────────────────────────────────────────────────────
  function handleBookSeat() {
    if (!selectedSeat) { toast.error('Select a seat first'); return }
    if (!profile) { toast.error('Please sign in'); router.push('/auth/login'); return }

    startTransition(async () => {
      const initRes = await initiateBooking({
        libraryId: library.id,
        seatId:    selectedSeat,
        startTime: startTime + ':00',
        endTime:   endTime   + ':00',
      })
      if (initRes.success === false) {
        toast.error(initRes.error)
        return
      }

      const { bookingId, amount, razorpayOrderId, razorpayKeyId, libraryName } = initRes.data

      openCheckout({
        orderId:     razorpayOrderId,
        keyId:       razorpayKeyId,
        amount,
        name:        libraryName,
        description: `Seat · ${fmtIST(startTime + ':00')}`,
        prefill: {
          name:  profile.full_name ?? profile.name ?? '',
          email: profile.email  ?? '',
          phone: profile.phone  ?? '',
        },
        onSuccess: async (paymentId, orderId, sig) => {
          startTransition(async () => {
            const confirmRes = await confirmBookingPayment({
              bookingId,
              razorpayOrderId:   orderId,
              razorpayPaymentId: paymentId,
              razorpaySignature: sig,
            })
            if (confirmRes.success === false) {
              toast.error(confirmRes.error)
              return
            }
            toast.success('Booking confirmed! 🎉')
            router.push('/bookings')
          })
        },
        onDismiss: () => toast.info('Payment cancelled. Your seat hold will expire in 15 min.'),
        onError:   (err) => toast.error(err),
      })
    })
  }

  // ── Subscribe to plan ─────────────────────────────────────────────────────
  function handleSubscribe(planId: string, planName: string) {
    if (!profile) { toast.error('Please sign in'); router.push('/auth/login'); return }

    startTransition(async () => {
      const initRes = await initiatePlanSubscription({ planId, libraryId: library.id })
      if (initRes.success === false) {
        toast.error(initRes.error)
        return
      }

      const { subscriptionId, amount, razorpayOrderId, razorpayKeyId } = initRes.data

      openCheckout({
        orderId:     razorpayOrderId,
        keyId:       razorpayKeyId,
        amount,
        name:        library.name,
        description: planName,
        prefill: {
          name:  profile.full_name ?? profile.name ?? '',
          email: profile.email  ?? '',
          phone: profile.phone  ?? '',
        },
        onSuccess: async (paymentId, orderId, sig) => {
          startTransition(async () => {
            const confirmRes = await confirmSubscriptionPayment({
              subscriptionId,
              razorpayOrderId:   orderId,
              razorpayPaymentId: paymentId,
              razorpaySignature: sig,
            })
            if (confirmRes.success === false) {
              toast.error(confirmRes.error)
              return
            }
            toast.success(`Subscribed to ${planName}! 🎉`)
            router.push('/subscriptions')
          })
        },
        onDismiss: () => toast.info('Subscription cancelled'),
        onError:   (err) => toast.error(err),
      })
    })
  }

  // ── Request book ──────────────────────────────────────────────────────────
  function handleBookRequest(bookId: string) {
    if (!profile) { toast.error('Please sign in'); router.push('/auth/login'); return }
    startTransition(async () => {
      const res = await requestBook({ bookId, libraryId: library.id })
      if (res.success === false) {
        toast.error(res.error)
        return
      }
      setRequestedBookId(bookId)
      toast.success('Book request sent!')
    })
  }

  return (
    <div className="min-h-screen bg-[#F4F7FB]">
      {/* ── Back header ──────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#E4EAF2]">
        <div className="max-w-3xl mx-auto px-4 h-[52px] flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-full bg-[#F4F7FB] flex items-center justify-center hover:bg-[#E8EFFE] transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-[#6E7F94]" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#0D1117] truncate">{library.name}</p>
            <p className="text-[11px] text-[#9AACBE] truncate">
              {[library.area, library.city].filter(Boolean).join(', ')}
            </p>
          </div>
          <span className={cn(
            'text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0',
            open ? 'bg-[#D1FAE5] text-[#0D7C54]' : 'bg-[#F4F7FB] text-[#9AACBE]',
          )}>
            {open ? '● Open' : '○ Closed'}
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* ── Image gallery ─────────────────────────────── */}
        {library.image_urls.length > 0 && (
          <div className="relative rounded-2xl overflow-hidden bg-[#F0EDE8] aspect-video">
            <Image
              src={library.image_urls[imgIdx] ?? ''}
              alt={library.name}
              fill priority
              sizes="(max-width:768px)100vw,672px"
              className="object-cover"
            />
            {library.image_urls.length > 1 && (
              <>
                <button
                  onClick={() => setImgIdx((i) => (i - 1 + library.image_urls.length) % library.image_urls.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 backdrop-blur flex items-center justify-center"
                >
                  <ChevronLeft className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() => setImgIdx((i) => (i + 1) % library.image_urls.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 backdrop-blur flex items-center justify-center"
                >
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
                <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {library.image_urls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setImgIdx(i)}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-200 bg-white',
                        i === imgIdx ? 'w-4 opacity-100' : 'w-1.5 opacity-50',
                      )}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Info card ──────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#E4EAF2] p-4 space-y-3">
          {/* Name + rating */}
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[18px] font-bold text-[#0D1117] leading-tight">{library.name}</h1>
            {library.rating > 0 && (
              <div className="flex items-center gap-1 bg-[#FEF3C7] px-2.5 py-1 rounded-xl flex-shrink-0">
                <Star className="w-3.5 h-3.5 text-[#F59E0B] fill-[#F59E0B]" />
                <span className="text-[13px] font-bold text-[#92400E]">{library.rating.toFixed(1)}</span>
                <span className="text-[11px] text-[#B45309]">({library.total_reviews})</span>
              </div>
            )}
          </div>

          {/* Location + distance */}
          <div className="flex items-center gap-3 flex-wrap text-[12px] text-[#9AACBE]">
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {[library.area, library.city].filter(Boolean).join(', ')}
            </span>
            {library.distance_km != null && (
              <span className="flex items-center gap-1">
                <Navigation2 className="w-3 h-3" />
                {library.distance_km < 1
                  ? `${(library.distance_km * 1000).toFixed(0)}m away`
                  : `${library.distance_km.toFixed(1)}km away`}
              </span>
            )}
            {library.latitude != null && library.longitude != null && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${library.latitude},${library.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[#1246FF] hover:underline"
              >
                Get Directions ↗
              </a>
            )}
          </div>

          {library.address && (
            <p className="text-[12px] text-[#6E7F94]">{library.address}</p>
          )}

          {/* Stat boxes */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#E8EFFE] rounded-xl p-3 text-center">
              <p className="text-[15px] font-bold text-[#1246FF]">₹{library.base_price}</p>
              <p className="text-[10px] text-[#9AACBE] mt-0.5">per hour</p>
            </div>
            <div className="bg-[#F4F7FB] rounded-xl p-3 text-center">
              <p className={cn(
                'text-[15px] font-bold',
                library.available_seats === 0 ? 'text-[#C5282C]'
                : library.available_seats <= 3 ? 'text-[#D97706]'
                : 'text-[#0D7C54]',
              )}>
                {library.available_seats}
              </p>
              <p className="text-[10px] text-[#9AACBE] mt-0.5">seats free</p>
            </div>
            <div className="bg-[#F4F7FB] rounded-xl p-3 text-center">
              <p className="text-[13px] font-semibold text-[#0D1117]">{fmtTime(library.open_time)}</p>
              <p className="text-[10px] text-[#9AACBE] mt-0.5">opens</p>
            </div>
          </div>

          {/* Hours */}
          <div className="flex items-center gap-1.5 text-[12px] text-[#6E7F94]">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            {fmtTime(library.open_time)} – {fmtTime(library.close_time)}
          </div>

          {/* Amenities */}
          {library.amenities.length > 0 && (
            <div>
              <div className="flex flex-wrap gap-1.5">
                {(showAllAmenities ? library.amenities : library.amenities.slice(0, 6)).map((a) => (
                  <span key={a} className="text-[11px] px-2 py-1 bg-[#F4F7FB] rounded-lg text-[#6E7F94] font-medium">
                    {AMENITY_ICON[a] ?? '✓'} {a}
                  </span>
                ))}
              </div>
              {library.amenities.length > 6 && (
                <button
                  onClick={() => setShowAllAmenities((v) => !v)}
                  className="flex items-center gap-0.5 text-[11px] text-[#1246FF] mt-1.5"
                >
                  {showAllAmenities
                    ? <><ChevronUp className="w-3 h-3" />Show less</>
                    : <><ChevronDown className="w-3 h-3" />+{library.amenities.length - 6} more</>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Tabs: Book / Plans / Books ──────────────────── */}
        <div className="bg-white rounded-xl border border-[#E4EAF2] overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#E4EAF2]">
            {(
              [
                { key: 'book',  label: 'Book Seat' },
                { key: 'plans', label: `Plans (${library.plans.length})`, hide: library.plans.length === 0 },
                { key: 'books', label: `Books (${books.length})`,         hide: books.length === 0 },
              ] as { key: Tab; label: string; hide?: boolean }[]
            ).filter((t) => !t.hide).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex-1 py-3 text-[12px] font-semibold transition-colors',
                  tab === key
                    ? 'text-[#1246FF] border-b-2 border-[#1246FF] -mb-px'
                    : 'text-[#9AACBE] hover:text-[#0D1117]',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ─── BOOK TAB ──────────────────────────────────── */}
          {tab === 'book' && (
            <div className="p-4">
              {step === 'time' && (
                <div className="space-y-3">
                  <h2 className="text-[13px] font-semibold text-[#0D1117]">Select Date & Time (IST)</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-[#9AACBE] uppercase tracking-wide mb-1.5">
                        Start Time
                      </label>
                      <input
                        type="datetime-local"
                        value={startTime}
                        onChange={(e) => { setStartTime(e.target.value); setSelectedSeat(null) }}
                        className="w-full px-3 py-2.5 bg-[#F4F7FB] border border-[#E4EAF2] rounded-xl text-[13px] text-[#0D1117] focus:outline-none focus:border-[#1246FF] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-[#9AACBE] uppercase tracking-wide mb-1.5">
                        End Time
                      </label>
                      <input
                        type="datetime-local"
                        value={endTime}
                        onChange={(e) => { setEndTime(e.target.value); setSelectedSeat(null) }}
                        className="w-full px-3 py-2.5 bg-[#F4F7FB] border border-[#E4EAF2] rounded-xl text-[13px] text-[#0D1117] focus:outline-none focus:border-[#1246FF] transition-colors"
                      />
                    </div>
                  </div>

                  {durationHrs > 0 && (
                    <div className="flex items-center justify-between bg-[#E8EFFE] rounded-xl px-4 py-2.5">
                      <span className="text-[12px] text-[#1246FF] font-medium">
                        {durationHrs.toFixed(1)} hr{durationHrs !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[15px] font-bold text-[#1246FF]">≈ ₹{estimatedCost}</span>
                    </div>
                  )}

                  <button
                    onClick={fetchSeats}
                    disabled={durationHrs <= 0 || loadingSeats || library.available_seats === 0}
                    className="w-full py-3 bg-[#1246FF] text-white rounded-xl text-[14px] font-semibold hover:bg-[#0E38CC] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {loadingSeats ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Checking seats…</>
                    ) : library.available_seats === 0 ? (
                      '🚫 Library is Full'
                    ) : (
                      <><Zap className="w-4 h-4" />Check Available Seats</>
                    )}
                  </button>
                </div>
              )}

              {step === 'seats' && (
                <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200">
                  {/* Step header */}
                  <div className="flex items-center justify-between">
                    <h2 className="text-[13px] font-semibold text-[#0D1117]">
                      Choose a Seat
                    </h2>
                    <button
                      onClick={() => { setStep('time'); setSeats([]); setSelectedSeat(null) }}
                      className="text-[11px] text-[#1246FF] hover:underline"
                    >
                      ← Change time
                    </button>
                  </div>

                  {/* Time summary */}
                  <div className="bg-[#F4F7FB] rounded-xl px-3 py-2 text-[11px] text-[#6E7F94]">
                    {fmtIST(startTime + ':00')} → {fmtIST(endTime + ':00').split(',').pop()?.trim()}
                    <span className="ml-2 font-semibold text-[#1246FF]">≈ ₹{estimatedCost}</span>
                  </div>

                  {/* SeatGrid component */}
                  <SeatGrid
                    seats={seats}
                    selectedId={selectedSeat}
                    onSelect={(id) => setSelectedSeat(id || null)}
                    loading={loadingSeats}
                  />

                  {/* Confirm strip */}
                  {selectedSeat && (
                    <div className="bg-[#E8EFFE] border border-[#1246FF]/20 rounded-xl p-3 flex items-center justify-between gap-3 animate-in fade-in duration-150">
                      <div>
                        <p className="text-[10px] text-[#9AACBE] uppercase tracking-wide">Selected</p>
                        <p className="text-[15px] font-bold text-[#0D1117]">
                          Seat {seats.find((s) => s.id === selectedSeat)?.label}
                        </p>
                        <p className="text-[11px] text-[#1246FF] font-medium">
                          {durationHrs.toFixed(1)} hrs · ₹{estimatedCost}
                        </p>
                      </div>
                      <button
                        onClick={handleBookSeat}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-[#1246FF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0E38CC] transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        {isPending
                          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <>Pay ₹{estimatedCost} <ArrowRight className="w-3.5 h-3.5" /></>}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── PLANS TAB ─────────────────────────────────── */}
          {tab === 'plans' && (
            <div className="p-4 space-y-3">
              {library.plans.length === 0 ? (
                <EmptyTab icon={CreditCard} title="No Plans" desc="This library has no membership plans yet." />
              ) : library.plans.map((plan, i) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  featured={i === 0}
                  loading={isPending}
                  onSubscribe={() => handleSubscribe(plan.id, plan.name)}
                />
              ))}
            </div>
          )}

          {/* ─── BOOKS TAB ─────────────────────────────────── */}
          {tab === 'books' && (
            <div className="p-4 space-y-0 divide-y divide-[#F4F7FB]">
              {books.length === 0 ? (
                <EmptyTab icon={BookOpen} title="No Books Listed" desc="This library has no catalogued books yet." />
              ) : books.map((book) => (
                <BookRow
                  key={book.id}
                  book={book}
                  requested={requestedBookId === book.id}
                  loading={isPending}
                  onRequest={() => handleBookRequest(book.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────────── */

function PlanCard({
  plan, featured, loading, onSubscribe,
}: {
  plan: LibraryCard['plans'][0]; featured: boolean; loading: boolean; onSubscribe: () => void
}) {
  const sessions = plan.session_limit
    ? isNaN(Number(plan.session_limit)) ? plan.session_limit : `${plan.session_limit} sessions`
    : 'Unlimited sessions'

  return (
    <div className={cn(
      'rounded-xl border p-4 relative',
      featured ? 'border-[#1246FF] bg-[#F5F8FF]' : 'border-[#E4EAF2] bg-white',
    )}>
      {featured && (
        <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 bg-[#1246FF] text-white rounded-full">
          Popular
        </span>
      )}
      <p className="text-[14px] font-bold text-[#0D1117]">{plan.name}</p>
      <p className="text-[11px] text-[#9AACBE] mt-0.5">{sessions} · {plan.duration_days} days</p>
      <div className="flex items-end justify-between mt-3">
        <div>
          <span className="text-[22px] font-extrabold text-[#0D1117]">₹{plan.price}</span>
          <span className="text-[11px] text-[#9AACBE] ml-1">total</span>
        </div>
        <button
          onClick={onSubscribe}
          disabled={loading}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50',
            featured
              ? 'bg-[#1246FF] text-white hover:bg-[#0E38CC]'
              : 'bg-[#F4F7FB] text-[#0D1117] border border-[#E4EAF2] hover:border-[#1246FF] hover:text-[#1246FF]',
          )}
        >
          {loading
            ? <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            : <>Subscribe <ArrowRight className="w-3.5 h-3.5" /></>}
        </button>
      </div>
    </div>
  )
}

function BookRow({
  book, requested, loading, onRequest,
}: {
  book: LibraryBook; requested: boolean; loading: boolean; onRequest: () => void
}) {
  const available = book.available_copies > 0
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-lg bg-[#E8EFFE] flex items-center justify-center flex-shrink-0">
        <BookOpen className="w-4 h-4 text-[#1246FF]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[#0D1117] truncate">{book.title}</p>
        {book.author && <p className="text-[11px] text-[#9AACBE]">by {book.author}</p>}
        <span className={cn('text-[10px] font-medium', available ? 'text-[#0D7C54]' : 'text-[#C5282C]')}>
          {available ? `${book.available_copies}/${book.total_copies} available` : 'Unavailable'}
        </span>
      </div>
      {requested ? (
        <span className="flex items-center gap-1 text-[11px] text-[#0D7C54] font-medium flex-shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />Requested
        </span>
      ) : (
        <button
          onClick={onRequest}
          disabled={loading || !available}
          className="flex-shrink-0 px-3 py-1.5 bg-[#F4F7FB] border border-[#E4EAF2] rounded-lg text-[11px] font-medium text-[#0D1117] hover:border-[#1246FF] hover:text-[#1246FF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Request
        </button>
      )}
    </div>
  )
}

function EmptyTab({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div className="w-12 h-12 rounded-2xl bg-[#F4F7FB] flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[#C4CDD8]" />
      </div>
      <p className="text-[13px] font-semibold text-[#0D1117]">{title}</p>
      <p className="text-[11px] text-[#9AACBE] mt-1 max-w-xs">{desc}</p>
    </div>
  )
}