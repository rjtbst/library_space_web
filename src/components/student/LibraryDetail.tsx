// components/student/LibraryDetail.tsx
'use client'

import { useState } from 'react'
import Link          from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Star, MapPin, Clock, Wifi, Wind, Volume2, Zap,
  Car, Coffee, ChevronLeft, ChevronRight, Users, Calendar,
  Zap as Flash,
} from 'lucide-react'
import { type OwnerSlot, type SlotOption, ownerSlotToOption } from '@/lib/libraryMeta'
import Image from 'next/image'

type Plan = { id: string; name: string; price: number; duration_days: number; session_limit: string | null }
type Library = {
  id: string; name: string; description: string | null
  city: string; area: string; address: string
  rating: number; total_reviews: number; base_price: number
  amenities: string[]; images: string[]
}

const AMENITY_ICONS: Record<string, React.ElementType> = {
  WiFi: Wifi, AC: Wind, 'Quiet Zone': Volume2, 'Power Sockets': Zap, Parking: Car, Cafe: Coffee,
}
const PLAN_COLORS = ['#0597A7', '#1E5CFF', '#6B3FD4', '#0A7C5C', '#C96A00']
const GRADS = ['linear-gradient(135deg,#E0E8FF,#C7D4F7)', 'linear-gradient(135deg,#D4EDD4,#B8DDB8)', 'linear-gradient(135deg,#F0E8FF,#DDD0F7)']

export default function LibraryDetail({
  library, ownerSlots, plans, freeSeats, isOpen, openHours, activeSub,
}: {
  library:    Library
  ownerSlots: OwnerSlot[]
  plans:      Plan[]
  freeSeats:  number
  isOpen:     boolean
  openHours:  string
  activeSub:  { planName: string; endDate: string } | null
}) {
  const router  = useRouter()
  const [imgIdx, setImgIdx] = useState(0)

  const slotOptions: SlotOption[] = ownerSlots.map(ownerSlotToOption)

  return (
    <div className="p-5 pb-32 max-w-3xl mx-auto">
      {/* Back + status */}
      <div className="flex items-center gap-2.5 mb-4">
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-[13px] font-medium text-[#6E7F94] hover:text-[#0D1117] transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <span className={[
          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
          isOpen ? 'bg-[#E2F5EE] text-[#065F46]' : 'bg-[#FDEAEA] text-[#9B1C1C]',
        ].join(' ')}>
          <span className="text-[8px]">●</span>
          {isOpen ? `Open · until ${openHours.split('–')[1]?.trim()}` : `Closed · opens ${openHours.split('–')[0]?.trim()}`}
        </span>
      </div>

      {/* Hero image */}
      <div className="relative rounded-xl overflow-hidden h-[200px] sm:h-[240px] mb-5 flex items-center justify-center text-7xl"
        style={{ background: library.images.length === 0 ? GRADS[0] : undefined }}>
        {library.images.length > 0
          ? <Image src={library.images[imgIdx % library.images.length]} alt={library.name} className="w-full h-full object-cover" />
          : '📚'}
        {library.images.length > 1 && <>
          <button onClick={() => setImgIdx((i) => (i - 1 + library.images.length) % library.images.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-lg flex items-center justify-center shadow hover:bg-white transition-all">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setImgIdx((i) => (i + 1) % library.images.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-lg flex items-center justify-center shadow hover:bg-white transition-all">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/50 text-white rounded-md text-[11px] font-semibold">
            {imgIdx + 1} / {library.images.length}
          </div>
        </>}
      </div>

      {/* Name + price */}
      <div className="grid grid-cols-[1fr_auto] gap-4 mb-4 items-start">
        <div>
          <h1 className="font-serif text-2xl text-[#0D1117] tracking-[-0.4px] mb-1">{library.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6E7F94] mb-1">
            <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{library.area}, {library.city}</span>
            <span className="w-[3px] h-[3px] rounded-full bg-[#9AACBE]" />
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {library.rating.toFixed(1)}
              <span className="text-[#9AACBE]"> ({library.total_reviews})</span>
            </span>
          </div>
          <div className="flex items-center gap-1 text-[12px] text-[#6E7F94]">
            <Clock className="w-3 h-3" /> Mon–Sun · {openHours}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-extrabold text-[#1E5CFF]">
            ₹{library.base_price}<span className="text-[13px] font-medium text-[#6E7F94]"> /hr</span>
          </div>
          <div className={['text-[12px] font-semibold mt-1', freeSeats > 0 && isOpen ? 'text-[#12A87A]' : 'text-[#9AACBE]'].join(' ')}>
            {isOpen ? (freeSeats > 0 ? `● ${freeSeats} seats free` : 'Library Full') : 'Check back later'}
          </div>
        </div>
      </div>

      {/* Description (plain text only — never raw JSON) */}
      {library.description && (
        <p className="text-[13px] text-[#6E7F94] leading-relaxed mb-4">{library.description}</p>
      )}

      {/* Active sub badge */}
      {activeSub && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-[10px] bg-[#E2F5EE] border border-[#0A7C5C]/20 text-[12px] text-[#0A7C5C] mb-4">
          <span className="text-base flex-shrink-0">⭐</span>
          <div>Active <b>{activeSub.planName}</b> membership — sessions included in your plan.</div>
        </div>
      )}

      {/* Amenities */}
      {library.amenities.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {library.amenities.map((a) => {
            const Icon = AMENITY_ICONS[a]
            return (
              <span key={a} className="flex items-center gap-1.5 text-[11px] text-[#3A4A5C] bg-[#F4F7FB] border border-[#E4EAF2] px-2.5 py-1 rounded-[7px]">
                {Icon && <Icon className="w-3 h-3 text-[#9AACBE]" />}{a}
              </span>
            )
          })}
        </div>
      )}

      {/* Owner-defined time slots (if set up) */}
      {slotOptions.length > 0 && (
        <div className="bg-white border border-[#E4EAF2] rounded-xl p-4 mb-5">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#0D1117] mb-3">
            <Flash className="w-4 h-4 text-amber-500" /> Available Time Slots
          </div>
          <div className="flex flex-col gap-2">
            {slotOptions.map((slot) => (
              <div key={slot.id}
                className="flex items-center justify-between p-3 rounded-[10px] bg-[#F4F7FB] border border-[#E4EAF2] cursor-pointer hover:border-[#1E5CFF] hover:bg-[#E8EFFE] transition-all group"
                onClick={() => router.push(`/student/book/${library.id}/seat`)}
              >
                <div>
                  <div className="text-[13px] font-semibold text-[#0D1117]">{slot.label}</div>
                  <div className="text-[11px] text-[#9AACBE] mt-0.5">{slot.days}</div>
                </div>
                <div className="text-right">
                  {slot.discount > 0 && (
                    <div className="text-[10px] text-[#9AACBE] line-through">₹{slot.basePrice}</div>
                  )}
                  <div className="text-[15px] font-extrabold text-[#1E5CFF]">₹{slot.finalPrice}</div>
                  {slot.discount > 0 && (
                    <div className="text-[9px] font-bold text-[#12A87A]">{slot.discount}% off</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-[#9AACBE] mt-3">Or book any custom duration at ₹{library.base_price}/hr</div>
        </div>
      )}

      {/* Membership Plans (dynamic from DB) */}
      {plans.length > 0 && (
        <div className="bg-white border border-[#E4EAF2] rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-bold text-[#0D1117]">Membership Plans</div>
            <Link href="/student/plans" className="text-[11px] text-[#1E5CFF] font-medium hover:underline">View all →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {plans.slice(0, 3).map((p, i) => (
              <div key={p.id}
                className="border-[1.5px] rounded-[10px] p-3 text-center cursor-pointer hover:shadow-[0_4px_24px_rgba(30,92,255,.1)] transition-all"
                style={{ borderColor: i === 1 ? '#1E5CFF' : '#E4EAF2', background: i === 1 ? 'linear-gradient(150deg,#F0F5FF,#F8FAFF)' : 'white' }}
                onClick={() => router.push('/student/plans')}
              >
                {i === 1 && <div className="text-[9px] font-bold text-[#1E5CFF] mb-0.5">⭐ Popular</div>}
                <div className="text-[12px] font-bold text-[#0D1117]">{p.name}</div>
                <div className="text-[20px] font-extrabold my-0.5" style={{ color: PLAN_COLORS[i % PLAN_COLORS.length] }}>₹{p.price}</div>
                <div className="text-[10px] text-[#6E7F94]">{p.duration_days}d · {p.session_limit ?? 'Unlimited'}</div>
                <div className="mt-2 text-[10px] text-[#1E5CFF] font-medium">Subscribe →</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Address */}
      <div className="bg-white border border-[#E4EAF2] rounded-xl p-4 mb-5">
        <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#0D1117] mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-[#9AACBE]" /> Location
        </div>
        <div className="text-[13px] text-[#6E7F94]">{library.address}</div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { icon: Users,    label: 'Free Seats', value: isOpen ? `${freeSeats}` : '—'       },
          { icon: Calendar, label: 'Open Days',  value: 'Mon–Sun'                            },
          { icon: Star,     label: 'Rating',     value: `${library.rating.toFixed(1)}/5`    },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white border border-[#E4EAF2] rounded-xl p-3 text-center">
            <Icon className="w-4 h-4 text-[#9AACBE] mx-auto mb-1" />
            <div className="text-[15px] font-bold text-[#0D1117]">{value}</div>
            <div className="text-[10px] text-[#9AACBE] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[252px] bg-white/95 backdrop-blur-sm border-t border-[#E4EAF2] px-5 py-4 z-50">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-[#0D1117] truncate">{library.name}</div>
            <div className="text-[11px] text-[#6E7F94]">
              {isOpen
                ? freeSeats > 0 ? `${freeSeats} seats · from ₹${library.base_price}/hr` : 'No seats available right now'
                : `Opens ${openHours.split('–')[0]?.trim()}`}
            </div>
          </div>
          <button
            disabled={!isOpen || freeSeats === 0}
            onClick={() => router.push(`/student/book/${library.id}/seat`)}
            className="flex-shrink-0 px-6 py-3 rounded-xl text-[14px] font-bold bg-[#1E5CFF] text-white shadow-[0_4px_24px_rgba(30,92,255,.3)] hover:bg-[#1447D4] hover:-translate-y-px transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {!isOpen ? 'Closed' : freeSeats === 0 ? 'Full' : 'Book Seat →'}
          </button>
        </div>
      </div>
    </div>
  )
}