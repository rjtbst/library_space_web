'use client'

import { useState, useTransition } from 'react'
import type { TodayBooking } from '@/lib/actions/owner'
import { checkInBooking } from '@/lib/actions/owner'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'

const SLOTS = ['All', '6–9 AM', '9 AM–12', '12–3 PM', '3–6 PM', '6–9 PM', '9–10 PM']
const SLOT_HOURS: Record<string, [number, number]> = {
  '6–9 AM':   [6,  9 ],
  '9 AM–12':  [9,  12],
  '12–3 PM':  [12, 15],
  '3–6 PM':   [15, 18],
  '6–9 PM':   [18, 21],
  '9–10 PM':  [21, 22],
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  confirmed:  { bg: BLUE_LIGHT,    color: '#1447D4',  label: 'Booked'       },
  checked_in: { bg: ACCENT_LIGHT,  color: '#0A5E3F',  label: '✓ Checked In' },
  held:       { bg: '#FEF3E2',     color: '#92400E',  label: 'Held'         },
  cancelled:  { bg: '#FEE2E2',     color: '#9B1C1C',  label: 'Cancelled'    },
  no_show:    { bg: '#FEE2E2',     color: '#9B1C1C',  label: 'No-show'      },
  completed:  { bg: '#F0FDF4',     color: '#14532D',  label: 'Completed'    },
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function BookingsClient({
  bookings: initial, libraryName, libraryId,
}: {
  bookings:    TodayBooking[]
  libraryName: string
  libraryId:   string
}) {
  const [bookings, setBookings] = useState(initial)
  const [activeSlot, setActiveSlot] = useState('All')
  const [isPending, startTransition] = useTransition()

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const filtered = activeSlot === 'All' ? bookings : bookings.filter(b => {
    const [sh, eh] = SLOT_HOURS[activeSlot] ?? [0, 24]
    const h = new Date(b.start_time).getHours()
    return h >= sh && h < eh
  })

  const checked = bookings.filter(b => b.status === 'checked_in').length
  const noShows = bookings.filter(b => b.status === 'no_show').length

  const handleCheckIn = (bookingId: string) => {
    startTransition(async () => {
      const res = await checkInBooking(bookingId)
      if (res.success) {
        setBookings(prev =>
          prev.map(b => b.id === bookingId ? { ...b, status: 'checked_in' } : b)
        )
      }
    })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#0A0D12', letterSpacing: '-0.03em', margin: 0, marginBottom: 4 }}>
            Today's Bookings
          </h1>
          <div style={{ fontSize: 13, color: '#6B7689' }}>{libraryName} · {today}</div>
        </div>
        <a
          href="/staff/scanner"
          style={{
            padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: ACCENT, color: '#fff', textDecoration: 'none',
            fontFamily: 'Syne, sans-serif', boxShadow: '0 2px 10px rgba(13,124,84,.25)',
            display: 'inline-block',
          }}
        >
          📷 QR Scanner
        </a>
      </div>

      {/* Slot tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {SLOTS.map(slot => (
          <button
            key={slot}
            onClick={() => setActiveSlot(slot)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${activeSlot === slot ? BLUE : '#E2DDD4'}`,
              background: activeSlot === slot ? BLUE_LIGHT : '#FDFCF9',
              color: activeSlot === slot ? BLUE : '#6B7689',
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            }}
          >
            {slot}
          </button>
        ))}
      </div>

      {/* Summary mini-cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { value: bookings.length, label: 'Total Today' },
          { value: bookings.filter(b => b.status === 'confirmed').length, label: 'Booked'      },
          { value: checked,                                                label: 'Checked-in'  },
          { value: noShows,                                                label: 'No-shows'    },
        ].map(({ value, label }) => (
          <div
            key={label}
            style={{
              flex: 1, minWidth: 80, background: '#FDFCF9',
              border: '1px solid #E2DDD4', borderRadius: 12,
              padding: '12px 14px', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12' }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: '#9AAAB8' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9AAAB8' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No bookings for this slot</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Seat', 'Student', 'Phone', 'Plan', 'Time', 'Status', 'Action'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 14px',
                      fontSize: 11, fontWeight: 700, color: '#9AAAB8',
                      textTransform: 'uppercase', letterSpacing: '.05em',
                      borderBottom: '1px solid #E2DDD4', background: '#F9F8F5',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.confirmed
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          padding: '3px 9px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                          background: BLUE_LIGHT, color: BLUE,
                        }}>
                          {b.seat_label}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0A0D12' }}>
                        {b.student}
                      </td>
                      <td style={{ padding: '11px 14px', color: '#9AAAB8', fontSize: 12 }}>
                        {b.phone ?? '—'}
                      </td>
                      <td style={{ padding: '11px 14px', color: '#6B7689' }}>
                        {b.plan}
                      </td>
                      <td style={{ padding: '11px 14px', color: '#6B7689', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          background: st.bg, color: st.color,
                        }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        {b.status === 'confirmed' && (
                          <button
                            disabled={isPending}
                            onClick={() => handleCheckIn(b.id)}
                            style={{
                              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                              background: ACCENT_LIGHT, color: ACCENT,
                              border: `1px solid rgba(13,124,84,.2)`,
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
        )}
      </div>
    </div>
  )
}