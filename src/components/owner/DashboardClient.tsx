// src/app/(owner)/dashboard/_components/DashboardClient.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardStats, MonthRevPoint, TodayBooking, SlotBand, OwnerLibrary } from '@/lib/actions/owner'
import { checkInBooking } from '@/lib/actions/owner'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function fmtCurrency(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}k`
  return `₹${n.toLocaleString('en-IN')}`
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function pctDelta(now: number, prev: number) {
  if (!prev) return now > 0 ? '+100%' : '—'
  const d = Math.round(((now - prev) / prev) * 100)
  return (d >= 0 ? '↑ ' : '↓ ') + Math.abs(d) + '%'
}
function deltaColor(now: number, prev: number) {
  return now >= prev ? ACCENT : '#C5282C'
}

/* ─── Stat card ────────────────────────────────────────────────────────────── */
function StatCard({
  icon, label, value, delta, deltaColor: dc, sub,
}: {
  icon: string; label: string; value: string
  delta?: string; deltaColor?: string; sub?: string
}) {
  return (
    <div style={{
      background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14,
      padding: '16px 18px', boxShadow: '0 2px 8px rgba(10,13,18,.04)',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12', letterSpacing: '-0.02em', marginBottom: 4 }}>
        {value}
      </div>
      {delta && (
        <div style={{ fontSize: 12, fontWeight: 600, color: dc ?? ACCENT }}>
          {delta}{sub ? <span style={{ color: '#9AAAB8', fontWeight: 400, marginLeft: 4 }}>{sub}</span> : null}
        </div>
      )}
    </div>
  )
}

/* ─── Revenue bar chart ────────────────────────────────────────────────────── */
function RevenueChart({ data }: { data: MonthRevPoint[] }) {
  const max     = Math.max(...data.map(d => d.amount), 1)
  const current = data[data.length - 1]
  const prev    = data[data.length - 2]

  return (
    <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12' }}>Monthly Revenue</div>
        <span style={{ fontSize: 11, color: '#9AAAB8', fontWeight: 500 }}>Last 7 months</span>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginBottom: 8 }}>
        {data.map((d, i) => {
          const isLast = i === data.length - 1
          const h      = max > 0 ? Math.max(4, Math.round((d.amount / max) * 90)) : 4
          return (
            <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              <div style={{
                width: '100%', height: h, borderRadius: '4px 4px 0 0',
                background: isLast
                  ? `linear-gradient(to top, ${BLUE}, #4A7FFF)`
                  : BLUE_LIGHT,
                boxShadow: isLast ? `0 -2px 8px rgba(30,92,255,.3)` : 'none',
                transition: 'height .3s ease',
              }} />
            </div>
          )
        })}
      </div>

      {/* Labels */}
      <div style={{ display: 'flex', gap: 6 }}>
        {data.map(d => (
          <div key={d.month} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: '#9AAAB8', fontWeight: 500 }}>
            {d.month}
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: '#E2DDD4', margin: '14px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, color: '#9AAAB8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>This month</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0A0D12', fontFamily: 'Syne, sans-serif' }}>
            {fmtCurrency(current?.amount ?? 0)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: '#9AAAB8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>vs last month</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: deltaColor(current?.amount ?? 0, prev?.amount ?? 0) }}>
            {pctDelta(current?.amount ?? 0, prev?.amount ?? 0)}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Occupancy donut ──────────────────────────────────────────────────────── */
function OccupancyDonut({ stats }: { stats: DashboardStats }) {
  const r   = 30
  const c   = 2 * Math.PI * r
  const pct = stats.occupancy_pct / 100

  return (
    <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12' }}>Seat Occupancy — Live</div>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: '#22C55E',
          animation: 'pulse 2s ease-in-out infinite',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
          <circle cx="40" cy="40" r={r} fill="none" stroke="#E2DDD4" strokeWidth="12" />
          <circle
            cx="40" cy="40" r={r} fill="none"
            stroke={BLUE} strokeWidth="12"
            strokeDasharray={`${c * pct} ${c * (1 - pct)}`}
            strokeDashoffset={c * 0.25}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray .6s ease' }}
          />
          <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0A0D12" fontFamily="DM Sans,sans-serif">
            {stats.occupancy_pct}%
          </text>
        </svg>

        <div style={{ flex: 1 }}>
          {[
            { color: BLUE,      label: 'Occupied', count: stats.occupied_seats },
            { color: ACCENT,    label: 'Available', count: stats.total_active_seats - stats.occupied_seats - stats.held_seats },
            { color: '#F59E0B', label: 'Held',     count: stats.held_seats },
          ].map(({ color, label, count }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#6B7689' }}>{label}: <strong style={{ color: '#0A0D12' }}>{count}</strong></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Slot heatmap ─────────────────────────────────────────────────────────── */
function SlotHeatmap({ data }: { data: SlotBand[] }) {
  return (
    <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12', marginBottom: 14 }}>Slot Popularity</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map(band => (
          <div key={band.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#9AAAB8', width: 60, flexShrink: 0 }}>{band.label}</span>
            <div style={{ flex: 1, background: '#F4F7FB', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{
                width: `${band.pct}%`, height: '100%', borderRadius: 4,
                background: band.pct > 80 ? BLUE : band.pct > 60 ? '#0597A7' : ACCENT,
                transition: 'width .4s ease',
              }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0A0D12', width: 28, textAlign: 'right' }}>
              {band.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Bookings table ────────────────────────────────────────────────────────── */
const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  confirmed:  { bg: '#E8EFFE', color: '#1447D4', label: 'Booked'     },
  checked_in: { bg: ACCENT_LIGHT, color: '#0A5E3F', label: '✓ Checked In' },
  held:       { bg: '#FEF3E2', color: '#92400E', label: 'Held'       },
  cancelled:  { bg: '#FEE2E2', color: '#9B1C1C', label: 'Cancelled'  },
  no_show:    { bg: '#FEE2E2', color: '#9B1C1C', label: 'No-show'    },
  completed:  { bg: '#F0FDF4', color: '#14532D', label: 'Completed'  },
}

function BookingsTable({
  bookings, onCheckIn,
}: {
  bookings: TodayBooking[]
  onCheckIn: (id: string) => void
}) {
  if (!bookings.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#9AAAB8' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>No bookings today yet</div>
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['Time', 'Student', 'Seat', 'Plan', 'Status', ''].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '8px 12px',
                fontSize: 11, fontWeight: 700, color: '#9AAAB8',
                textTransform: 'uppercase', letterSpacing: '.05em',
                borderBottom: '1px solid #E2DDD4',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bookings.map(b => {
            const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.confirmed
            const canCheckIn = b.status === 'confirmed'
            return (
              <tr key={b.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                <td style={{ padding: '10px 12px', color: '#6B7689', whiteSpace: 'nowrap' }}>
                  {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0A0D12' }}>
                  {b.student}
                  {b.phone && (
                    <div style={{ fontSize: 11, fontWeight: 400, color: '#9AAAB8' }}>{b.phone}</div>
                  )}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                    background: BLUE_LIGHT, color: BLUE,
                  }}>
                    {b.seat_label}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#6B7689' }}>{b.plan}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: st.bg, color: st.color,
                  }}>
                    {st.label}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {canCheckIn && (
                    <button
                      onClick={() => onCheckIn(b.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        background: ACCENT_LIGHT, color: ACCENT, border: `1px solid rgba(13,124,84,.2)`,
                        cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                      }}
                    >
                      ✓ Check-in
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ─── Quick actions ─────────────────────────────────────────────────────────── */
function QuickActions() {
  const router = useRouter()
  const actions = [
    { icon: '📷', label: 'QR Scanner',    href: '/staff/scanner'                   },
    { icon: '💺', label: 'Seat Manager',  href: '/dashboard/seat-manager'    },
    { icon: '⏰', label: 'Slot Config',   href: '/dashboard/slot-config'     },
    { icon: '🎯', label: 'Plan Builder',  href: '/dashboard/plan-builder'    },
  ]
  return (
    <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12', marginBottom: 12 }}>Quick Actions</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map(a => (
          <button
            key={a.href}
            onClick={() => router.push(a.href)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 9,
              border: '1.5px solid #E2DDD4', background: '#FDFCF9',
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              fontSize: 13, fontWeight: 500, color: '#3A4A5C',
              transition: 'all .12s', textAlign: 'left',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = ACCENT
              e.currentTarget.style.color = ACCENT
              e.currentTarget.style.background = ACCENT_LIGHT
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#E2DDD4'
              e.currentTarget.style.color = '#3A4A5C'
              e.currentTarget.style.background = '#FDFCF9'
            }}
          >
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            {a.label}
            <span style={{ marginLeft: 'auto', color: '#C8D4C8' }}>→</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─── Library selector ─────────────────────────────────────────────────────── */
function LibraryPill({
  libraries, selected, onSelect,
}: {
  libraries: OwnerLibrary[]
  selected: string
  onSelect: (id: string) => void
}) {
  if (libraries.length <= 1) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {libraries.map(lib => {
        const active = lib.id === selected
        return (
          <button
            key={lib.id}
            onClick={() => onSelect(lib.id)}
            style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${active ? ACCENT : '#E2DDD4'}`,
              background: active ? ACCENT_LIGHT : '#FDFCF9',
              color: active ? ACCENT : '#6B7689',
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            }}
          >
            {lib.name}
          </button>
        )
      })}
    </div>
  )
}

/* ─── Main client component ────────────────────────────────────────────────── */
export default function DashboardClient({
  libraryName, libraryId, libraries, stats, revenue, bookings, heatmap,
}: {
  libraryName: string
  libraryId:   string
  libraries:   OwnerLibrary[]
  stats:       DashboardStats | null
  revenue:     MonthRevPoint[]
  bookings:    TodayBooking[]
  heatmap:     SlotBand[]
}) {
  const router = useRouter()
  const [localBookings, setLocalBookings] = useState(bookings)
  const [isPending, startTransition] = useTransition()

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const handleCheckIn = (bookingId: string) => {
    startTransition(async () => {
      const res = await checkInBooking(bookingId)
      if (res.success) {
        setLocalBookings(prev =>
          prev.map(b => b.id === bookingId ? { ...b, status: 'checked_in' } : b)
        )
      }
    })
  }

  const s = stats ?? {
    today_revenue: 0, yesterday_revenue: 0, today_bookings: 0, yesterday_bookings: 0,
    occupancy_pct: 0, occupied_seats: 0, total_active_seats: 0, held_seats: 0,
    total_members: 0, new_members_month: 0,
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#0A0D12', letterSpacing: '-0.03em', margin: 0, marginBottom: 4 }}>
            Owner Dashboard
          </h1>
          <div style={{ fontSize: 13, color: '#6B7689' }}>
            {libraryName} · {today}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => router.push('/onboarding/add-library')}
            style={{
              padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
              background: ACCENT, color: '#fff', border: 'none',
              cursor: 'pointer', fontFamily: 'Syne, sans-serif',
              boxShadow: '0 2px 10px rgba(13,124,84,.25)',
            }}
          >
            + Add Library
          </button>
        </div>
      </div>

      {/* Library selector (multi-library owners) */}
      {libraries.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <LibraryPill
            libraries={libraries}
            selected={libraryId}
            onSelect={id => router.push(`/dashboard?lib=${id}`)}
          />
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard
          icon="₹"
          label="Today's Revenue"
          value={fmtCurrency(s.today_revenue)}
          delta={pctDelta(s.today_revenue, s.yesterday_revenue) + ' vs yesterday'}
          deltaColor={deltaColor(s.today_revenue, s.yesterday_revenue)}
        />
        <StatCard
          icon="📋"
          label="Bookings Today"
          value={String(s.today_bookings)}
          delta={`${s.today_bookings >= s.yesterday_bookings ? '↑' : '↓'} ${Math.abs(s.today_bookings - s.yesterday_bookings)} from yesterday`}
          deltaColor={s.today_bookings >= s.yesterday_bookings ? ACCENT : '#C5282C'}
        />
        <StatCard
          icon="💺"
          label="Occupancy Rate"
          value={`${s.occupancy_pct}%`}
          delta={`${s.occupied_seats} / ${s.total_active_seats} seats active`}
          deltaColor="#6B7689"
        />
        <StatCard
          icon="⭐"
          label="Members"
          value={String(s.total_members)}
          delta={`↑ ${s.new_members_month} this month`}
          deltaColor={ACCENT}
        />
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Revenue chart */}
          <RevenueChart data={revenue} />

          {/* Today's bookings */}
          <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #E2DDD4' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12' }}>
                Today's Bookings
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: BLUE_LIGHT, color: BLUE,
                }}>
                  {s.today_bookings} total
                </span>
                <button
                  onClick={() => router.push('/dashboard/bookings')}
                  style={{
                    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    border: '1.5px solid #E2DDD4', background: '#FDFCF9',
                    color: '#3A4A5C', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  View all →
                </button>
              </div>
            </div>
            <div style={{ padding: '0 0 4px' }}>
              <BookingsTable bookings={localBookings.slice(0, 6)} onCheckIn={handleCheckIn} />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <OccupancyDonut stats={s} />
          <SlotHeatmap data={heatmap} />
          <QuickActions />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: .6; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}