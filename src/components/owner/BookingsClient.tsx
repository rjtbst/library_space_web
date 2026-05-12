'use client'
import { useState, useTransition, useMemo, useCallback } from 'react'
import type { TodayBooking } from '@/lib/actions/owner'
import { checkInBooking } from '@/lib/actions/owner'
import { fmtTime, getISTHour, fmtISTDate } from '@/lib/utils/format'
import { ACCENT, ACCENT_LIGHT, BLUE, BLUE_LIGHT } from '@/lib/constants/theme'
import { Card, PageHeader, EmptyState, StatusBadge } from '@/components/owner/ui'

const SLOTS = ['All', '6–9 AM', '9 AM–12', '12–3 PM', '3–6 PM', '6–9 PM', '9–10 PM']
const SLOT_HOURS: Record<string, [number, number]> = {
  '6–9 AM':  [6,9], '9 AM–12': [9,12], '12–3 PM': [12,15],
  '3–6 PM':  [15,18], '6–9 PM': [18,21], '9–10 PM': [21,22],
}

export default function BookingsClient({
  bookings: initial, libraryName, libraryId,
}: {
  bookings:    TodayBooking[]
  libraryName: string
  libraryId:   string
}) {
  const [bookings, setBookings]      = useState(initial)
  const [activeSlot, setActiveSlot]  = useState('All')
  const [isPending, startTransition] = useTransition()

  // ← useMemo: filtered list only recomputes when bookings or slot changes
  const filtered = useMemo(() => {
    if (activeSlot === 'All') return bookings
    const [sh, eh] = SLOT_HOURS[activeSlot] ?? [0, 24]
    return bookings.filter(b => {
      const h = getISTHour(b.start_time)
      return h >= sh && h < eh
    })
  }, [bookings, activeSlot])

  // ← useMemo: summary counts
  const summary = useMemo(() => ({
    total:     bookings.length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    checkedIn: bookings.filter(b => b.status === 'checked_in').length,
    noShows:   bookings.filter(b => b.status === 'no_show').length,
  }), [bookings])

  // ← useCallback: stable reference, no re-creation on every render
  const handleCheckIn = useCallback((bookingId: string) => {
    startTransition(async () => {
      const res = await checkInBooking(bookingId)
      if (res.success) {
        setBookings(prev =>
          prev.map(b => b.id === bookingId ? { ...b, status: 'checked_in' } : b)
        )
      }
    })
  }, [])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      <PageHeader
        title="Today's Bookings"
        subtitle={`${libraryName} · ${fmtISTDate()}`}
        action={
          <a href="/staff/scanner" style={{
            padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: ACCENT, color: '#fff', textDecoration: 'none',
            fontFamily: 'Syne, sans-serif', boxShadow: '0 2px 10px rgba(13,124,84,.25)',
            display: 'inline-block',
          }}>
            📷 QR Scanner
          </a>
        }
      />

      {/* Slot tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {SLOTS.map(slot => (
          <button key={slot} onClick={() => setActiveSlot(slot)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: `1.5px solid ${activeSlot === slot ? BLUE : '#E2DDD4'}`,
            background: activeSlot === slot ? BLUE_LIGHT : '#FDFCF9',
            color: activeSlot === slot ? BLUE : '#6B7689',
            cursor: 'pointer',
          }}>
            {slot}
          </button>
        ))}
      </div>

      {/* Summary mini-cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { value: summary.total,     label: 'Total Today' },
          { value: summary.confirmed, label: 'Booked'      },
          { value: summary.checkedIn, label: 'Checked-in'  },
          { value: summary.noShows,   label: 'No-shows'    },
        ].map(({ value, label }) => (
          <div key={label} style={{
            flex: 1, minWidth: 80, background: '#FDFCF9',
            border: '1px solid #E2DDD4', borderRadius: 12,
            padding: '12px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12' }}>{value}</div>
            <div style={{ fontSize: 11, color: '#9AAAB8' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="📭" title="No bookings for this slot" />
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
                {filtered.map(b => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #F0EDE8' }}>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: BLUE_LIGHT, color: BLUE }}>
                        {b.seat_label}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#0A0D12' }}>{b.student}</td>
                    <td style={{ padding: '11px 14px', color: '#9AAAB8', fontSize: 12 }}>{b.phone ?? '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#6B7689' }}>{b.plan}</td>
                    <td style={{ padding: '11px 14px', color: '#6B7689', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <StatusBadge status={b.status} />
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
                            cursor: 'pointer',
                          }}
                        >
                          ✓ Check-in
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}