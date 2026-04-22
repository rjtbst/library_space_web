'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

/* ─── Mini Seat Grid ─── */
const SEAT_DATA = [
  ['taken','free','free','taken','taken','free','free','taken'],
  ['free','sel','free','taken','free','free','taken','free'],
  ['taken','free','taken','free','taken','free','free','taken'],
]

 const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

function SeatMini({ status }: { status: string }) {
  const colors: Record<string, string> = {
    free:  '#D1FAE5',
    taken: '#FEE2E2',
    sel:   '#DBEAFE',
  }
  const before: Record<string, string> = {
    free:  '#10B981',
    taken: '#EF4444',
    sel:   '#1D4ED8',
  }
  return (
    <div
      style={{
        width: 22, height: 22, borderRadius: 4,
        background: colors[status],
        position: 'relative',
        flexShrink: 0,
        boxShadow: status === 'sel' ? '0 0 0 2px #1D4ED8' : undefined,
      }}
    >
      <div style={{
        position: 'absolute', top: -3, left: 2, right: 2, height: 3,
        borderRadius: '2px 2px 0 0', background: before[status],
      }} />
    </div>
  )
}

/* ─── Map pins ─── */
const MAP_PINS = [
  { name: 'Silence Hub',    top: '20%', left: '22%', color: '#10B981' },
  { name: 'Knowledge Park', top: '50%', left: '58%', color: '#F59E0B' },
  { name: 'EduNest',        top: '30%', left: '72%', color: '#10B981' },
  { name: 'ReadSpace',      top: '65%', left: '35%', color: '#EF4444' },
]

/* ─── Component ─── */
export default function HeroSection() {
  const [booked, setBooked] = useState(false)
  const [showNotif, setShowNotif] = useState(false)

  const handleBook = () => {
    setBooked(true)
    setTimeout(() => {
      setShowNotif(true)
      setTimeout(() => {
        setBooked(false)
        setShowNotif(false)
      }, 3000)
    }, 400)
  }

  return (
    <section
      id="hero"
      className="relative min-h-screen flex flex-col justify-center overflow-hidden"
      style={{ paddingTop: 120, paddingBottom: 60, paddingLeft: 40, paddingRight: 40 }}
    >
      {/* Background blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 opacity-[0.035]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
        />
        <div className="absolute animate-blob"
          style={{ width: 700, height: 700, top: -200, right: -100, borderRadius: '50%', background: 'radial-gradient(circle, rgba(18,70,255,.08) 0%, transparent 70%)' }}
        />
        <div className="absolute animate-blob"
          style={{ width: 500, height: 500, bottom: -100, left: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,124,84,.06) 0%, transparent 70%)', animationDelay: '4s' }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-[1200px] mx-auto w-full">
        {/* Eyebrow */}
        <div className="animate-fade-up delay-100 inline-flex items-center gap-2 mb-7"
          style={{ background: 'var(--warm)', border: '1px solid var(--gold)', borderRadius: 20, padding: '6px 14px' }}
        >
          <span className="animate-pulse-dot w-1.5 h-1.5 rounded-full bg-gold" />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold)' }}>
            🚀 Now live in Haldwani, UK
          </span>
        </div>

        {/* Headline */}
        <h1
          className="animate-fade-up delay-200 font-syne font-extrabold text-ink mb-0"
          style={{ fontSize: 'clamp(38px, 4vw, 96px)', lineHeight: 0.93, letterSpacing: '-0.04em' }}
        >
          <span className="block">Your study seat,</span>
          <span className="block text-blue" style={{ fontFamily: 'Instrument Serif, serif', fontWeight: 400, letterSpacing: '-0.03em' }}>
            booked in seconds
          </span>
        </h1>

        {/* Sub */}
        <p className="animate-fade-up delay-300 mt-7 mb-10 text-muted font-light leading-relaxed"
          style={{ fontSize: 18, maxWidth: 540 }}
        >
          Find the perfect study library near you, see live seat availability, and reserve your spot — all before you leave home.
        </p>

        {/* Actions */}
        <div className="animate-fade-up delay-400 flex flex-wrap gap-3 items-center">
         <Link
            href="/login?mode=signup"

            className="btn-hero flex items-center gap-2 text-white bg-blue shadow-blue hover:bg-blue-dk hover:-translate-y-0.5 transition-all font-syne"
            style={{ padding: '15px 32px', borderRadius: 12, fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', border: 'none', cursor: 'pointer' }}
          >
            📚 Find a library near me <span>→</span>
          </Link>
             <button
            onClick={() => scrollToSection('howitworks')}
            className="transition-all font-semibold"
            style={{ padding: '15px 28px', borderRadius: 12, fontSize: 15, background: 'transparent', color: 'var(--ink)', border: '2px solid var(--divider)', cursor: 'pointer' }}
            onMouseEnter={e => { const t = e.currentTarget; t.style.borderColor = 'var(--ink)'; t.style.background = 'var(--warm)' }}
            onMouseLeave={e => { const t = e.currentTarget; t.style.borderColor = 'var(--divider)'; t.style.background = 'transparent' }}
          >
            See how it works
          </button>
        </div>

        {/* Social proof */}
        <div className="animate-fade-up delay-500 flex items-center gap-4 mt-7">
          <div className="flex">
            {[
              { initials: 'AS', gradient: 'linear-gradient(135deg,#1246FF,#4A7CFF)' },
              { initials: 'PK', gradient: 'linear-gradient(135deg,#0D7C54,#12B07A)' },
              { initials: 'RS', gradient: 'linear-gradient(135deg,#C8A84B,#E8C56A)' },
              { initials: 'VM', gradient: 'linear-gradient(135deg,#6B3FD4,#A855F7)' },
              { initials: '+',  gradient: 'linear-gradient(135deg,#D42B2B,#F87171)' },
            ].map((av, i) => (
              <div key={i} style={{
                width: 30, height: 30, borderRadius: '50%',
                background: av.gradient,
                border: '2px solid var(--surface)',
                marginLeft: i === 0 ? 0 : -8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>{av.initials}</div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Trusted by <strong style={{ color: 'var(--ink)' }}>2,400+ students</strong> across Haldwani
          </p>
        </div>
      </div>

      {/* Hero visual cards */}
      <div
        className="animate-fade-right delay-300 hidden lg:block absolute z-10"
        style={{ right: 40, top: '30%', transform: 'translateY(-50%)', width: 460 }}
      >
        {/* Map card */}
        <div className="card p-5 mb-3 shadow-xl">
          <div className="flex items-center justify-between mb-2.5">
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>📍 Near you in Haldwani</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>3 libraries open</span>
          </div>
          {/* Mini map */}
          <div className="relative rounded-xl overflow-hidden mb-3"
            style={{ height: 96, background: 'linear-gradient(140deg, #D9E8F4, #C0D8EE)' }}
          >
            <div className="absolute inset-0"
              style={{ backgroundImage: 'linear-gradient(rgba(80,120,180,.15) 1px,transparent 1px),linear-gradient(90deg,rgba(80,120,180,.15) 1px,transparent 1px)', backgroundSize: '20px 20px' }}
            />
            {MAP_PINS.map((pin) => (
              <div key={pin.name} className="absolute flex flex-col items-center gap-0.5"
                style={{ top: pin.top, left: pin.left }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: pin.color, border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                <div style={{ background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                  {pin.name}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Seat card */}
        <div className="card p-5 shadow-xl relative">
          {/* Library header */}
          <div className="flex items-center gap-3 mb-3.5">
            <div className="w-11 h-11 rounded-[10px] flex items-center justify-center text-[22px] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#E0E8FF,#C7D4F7)' }}
            >📚</div>
            <div className="flex-1">
              <div className="font-syne font-bold text-ink" style={{ fontSize: 14 }}>Silence Study Hub</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Civil Lines · ⭐ 4.8 · 0.8 km</div>
            </div>
            <div className="chip chip-green" style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>● Open</div>
          </div>

          {/* Seat grid */}
          <div className="mb-3">
            {SEAT_DATA.map((row, ri) => (
              <div key={ri} className="flex gap-1 mb-1">
                {row.map((seat, ci) => (
                  <SeatMini key={ci} status={seat} />
                ))}
              </div>
            ))}
          </div>

          {/* Price + CTA */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-syne font-extrabold text-blue" style={{ fontSize: 22, letterSpacing: '-1px' }}>
                ₹25 <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/hr</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--green2)', fontWeight: 600 }}>● 18 seats available</div>
            </div>
            <button
              onClick={handleBook}
              style={{
                background: booked ? 'var(--green2)' : 'var(--blue)',
                color: '#fff', border: 'none', borderRadius: 9,
                padding: '10px 18px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                transition: 'background 0.2s',
              }}
            >
              {booked ? '✓ Booked!' : 'Book Now →'}
            </button>
          </div>

          {/* Notification pill */}
          {showNotif && (
            <div
              className="animate-notif notif-pill"
              style={{ position: 'absolute', bottom: -16, right: -16 }}
            >
              <div className="np-icon" style={{ background: '#D1FAE5' }}>✅</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>Booking Confirmed!</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>WhatsApp sent · Seat C3</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}