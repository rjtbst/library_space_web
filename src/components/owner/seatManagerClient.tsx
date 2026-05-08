'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SeatRow, OwnerLibrary } from '@/lib/actions/owner'
import { toggleSeatActive, addSeatRow, manualBookSeat, forceFreeSeat } from '@/lib/actions/owner'
import {
  toISTInputValue,
  inputToDB,
  fmtIST,
  fmtInputPreview,
  validateISTRange,
} from '@/lib/ist'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'
const RED          = '#DC2626'
const RED_LIGHT    = '#FEE2E2'

const SEAT_COLORS: Record<string, { bg: string; border: string; color: string; label: string }> = {
  free:     { bg: '#F0FDF4',  border: '#86EFAC', color: ACCENT,    label: 'Free'     },
  booked:   { bg: BLUE_LIGHT, border: '#93C5FD', color: BLUE,      label: 'Booked'   },
  held:     { bg: '#FEF3E2',  border: '#FCD34D', color: '#92400E', label: 'Held'     },
  inactive: { bg: '#F4F7FB',  border: '#E2DDD4', color: '#9AAAB8', label: 'Inactive' },
}

/* ─── Default form times ─────────────────────────────────────────────────── */
// toISTInputValue converts a JS Date to "YYYY-MM-DDTHH:mm" in IST
function defaultTimes() {
  const now = new Date()
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  return { start: toISTInputValue(now), end: toISTInputValue(end) }
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function SeatManagerClient({
  seats: initial, libraryId, libraryName, libraries,
}: {
  seats:       SeatRow[]
  libraryId:   string
  libraryName: string
  libraries:   OwnerLibrary[]
}) {
  const router = useRouter()
  const [seats, setSeats]             = useState(initial)
  const [selected, setSelected]       = useState<SeatRow | null>(null)
  const [isPending, startTransition]  = useTransition()
  const [showAddRow, setShowAddRow]   = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('')
  const [newRowCols, setNewRowCols]   = useState(8)
  const [toast, setToast]             = useState('')

  const [bookForm, setBookForm] = useState({
    userName:    '',
    userPhone:   '',
    ...defaultTimes(),
    bookingMode: 'offline' as 'online' | 'offline',
    amountPaid:  '',
    paymentMode: 'cash' as 'cash' | 'upi' | 'other',
    paymentNote: '',
  })
  const [confirmForceFree, setConfirmForceFree] = useState(false)

  const rows = Array.from(new Set(seats.map(s => s.row_label))).sort()

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const resetForm = () =>
    setBookForm({
      userName: '', userPhone: '', ...defaultTimes(),
      bookingMode: 'offline',
      amountPaid: '', paymentMode: 'cash', paymentNote: '',
    })

  /* ── handlers ────────────────────────────────────────────────────────── */
  const handleToggle = () => {
    if (!selected) return
    const newVal = !selected.is_active
    startTransition(async () => {
      const res = await toggleSeatActive(selected.id, libraryId, newVal)
      if (res.success) {
        const updated = { ...selected, is_active: newVal, live_status: newVal ? 'free' : 'inactive' } as SeatRow
        setSeats(prev => prev.map(s => s.id === selected.id ? updated : s))
        setSelected(updated)
        showToast(`Seat ${selected.row_label}${selected.column_number} ${newVal ? 'activated' : 'deactivated'}`)
      }
    })
  }

  const handleManualBook = () => {
    if (!selected) return
    const { userName, userPhone, start, end, bookingMode, amountPaid, paymentMode, paymentNote } = bookForm

    if (!userName.trim()) { showToast('Student name is required'); return }
    if (userPhone.replace(/\D/g, '').length < 10) { showToast('Enter a valid 10-digit phone number'); return }

    // inputToDB: "YYYY-MM-DDTHH:mm" → "YYYY-MM-DDTHH:mm:00" (adds seconds for DB)
    // No timezone conversion — values are already IST, stored as-is
    const startDB = inputToDB(start)
    const endDB   = inputToDB(end)

    // Validate range on client before hitting server
    const rangeCheck = validateISTRange(startDB, endDB, 24)
    // if (!rangeCheck.ok) { showToast(rangeCheck.error); return }

    const parsedAmount = amountPaid ? parseFloat(amountPaid) : 0
    if (amountPaid && isNaN(parsedAmount)) { showToast('Enter a valid amount'); return }

    startTransition(async () => {
      const res = await manualBookSeat({
        seatId:      selected.id,
        libraryId,
        userName:    userName.trim(),
        userPhone:   userPhone.trim(),
        startTime:   startDB,   // plain IST — no UTC conversion
        endTime:     endDB,     // plain IST — no UTC conversion
        bookingMode,
        amountPaid:  parsedAmount,
        paymentMode,
        paymentNote: paymentNote.trim(),
      })
      if (res.success) {
        const updated = { ...selected, live_status: 'booked' as SeatRow['live_status'] }
        setSeats(prev => prev.map(s => s.id === selected.id ? updated : s))
        setSelected(updated)
        resetForm()
        const payStr = parsedAmount > 0 ? ` · ₹${parsedAmount} ${paymentMode}` : ''
        showToast(`Seat ${selected.row_label}${selected.column_number} booked for ${userName}${payStr}`)
      } else {
        showToast((res as any).error ?? 'Booking failed')
      }
    })
  }

  const handleForceFree = () => {
    if (!selected) return
    startTransition(async () => {
      const res = await forceFreeSeat(selected.id, libraryId)
      if (res.success) {
        const updated = { ...selected, live_status: 'free' as SeatRow['live_status'] }
        setSeats(prev => prev.map(s => s.id === selected.id ? updated : s))
        setSelected(updated)
        setConfirmForceFree(false)
        showToast(`Seat ${selected.row_label}${selected.column_number} cleared`)
      } else {
        showToast((res as any).error ?? 'Failed to clear seat')
        setConfirmForceFree(false)
      }
    })
  }

  const handleAddRow = () => {
    if (!newRowLabel.trim()) return
    startTransition(async () => {
      const res = await addSeatRow(libraryId, newRowLabel, newRowCols)
      if (res.success) {
        showToast(`Row ${newRowLabel.toUpperCase()} added`)
        setShowAddRow(false)
        setNewRowLabel('')
        router.refresh()
      }
    })
  }

  /* ── stats ───────────────────────────────────────────────────────────── */
  const active   = seats.filter(s => s.is_active).length
  const booked   = seats.filter(s => s.live_status === 'booked').length
  const inactive = seats.filter(s => !s.is_active).length

  /* ── shared input style ──────────────────────────────────────────────── */
  const inp: React.CSSProperties = {
    padding: '9px 12px', border: '1.5px solid #E2DDD4', borderRadius: 9,
    fontSize: 13, color: '#0A0D12', outline: 'none', width: '100%',
    fontFamily: 'DM Sans, sans-serif', background: '#FDFCF9',
    boxSizing: 'border-box',
  }
  const sel: React.CSSProperties = { ...inp, cursor: 'pointer' }

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          background: '#0A0D12', color: '#fff', padding: '10px 18px',
          borderRadius: 10, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.2)', animation: 'fadeIn .2s ease',
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#0A0D12', letterSpacing: '-0.03em', margin: 0, marginBottom: 4 }}>
            Seat Manager
          </h1>
          <div style={{ fontSize: 13, color: '#6B7689' }}>{libraryName} · {seats.length} seats · IST</div>
        </div>
        <button
          onClick={() => setShowAddRow(v => !v)}
          style={{
            padding: '8px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
            border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
            cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
          }}
        >
          + Add Row
        </button>
      </div>

      {/* Library picker */}
      {libraries.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {libraries.map(lib => (
            <button key={lib.id}
              onClick={() => router.push(`/dashboard/seat-manager?lib=${lib.id}`)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: `1.5px solid ${lib.id === libraryId ? ACCENT : '#E2DDD4'}`,
                background: lib.id === libraryId ? ACCENT_LIGHT : '#FDFCF9',
                color: lib.id === libraryId ? ACCENT : '#6B7689',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              {lib.name}
            </button>
          ))}
        </div>
      )}

      {/* Info banner */}
      <div style={{ background: BLUE_LIGHT, border: `1px solid rgba(30,92,255,.2)`, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span>💡</span>
        <span style={{ fontSize: 13, color: '#1447D4' }}>
          Click any seat to select · All times are IST (Asia/Kolkata)
        </span>
      </div>

      {/* Floor grid */}
      <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #E2DDD4' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12' }}>Floor Layout</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { label: `${active} active`,  bg: ACCENT_LIGHT, color: ACCENT    },
              { label: `${booked} booked`,  bg: BLUE_LIGHT,   color: BLUE      },
              { label: `${inactive} off`,   bg: '#F4F7FB',    color: '#9AAAB8' },
            ].map(({ label, bg, color }) => (
              <span key={label} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color }}>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: 16, overflowX: 'auto' }}>
          {seats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9AAAB8' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💺</div>
              <div>No seats configured yet. Add a row to get started.</div>
            </div>
          ) : rows.map(row => {
            const rowSeats = seats.filter(s => s.row_label === row).sort((a, b) => a.column_number - b.column_number)
            return (
              <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6, background: '#F4F7FB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#6B7689', flexShrink: 0,
                }}>
                  {row}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {rowSeats.map((seat, idx) => {
                    const sc         = SEAT_COLORS[seat.live_status]
                    const isSelected = selected?.id === seat.id
                    return (
                      <div key={seat.id} style={{ display: 'flex', alignItems: 'center' }}>
                        {idx === 4 && <div style={{ width: 10 }} />}
                        <button
                          onClick={() => {
                            setSelected(seat.id === selected?.id ? null : seat)
                            setConfirmForceFree(false)
                            resetForm()
                          }}
                          style={{
                            width: 38, height: 38, borderRadius: 7,
                            background: sc.bg,
                            border: `2px solid ${isSelected ? '#0A0D12' : sc.border}`,
                            color: sc.color, fontSize: 10, fontWeight: 700,
                            cursor: 'pointer', transition: 'all .12s',
                            boxShadow: isSelected ? '0 0 0 3px rgba(10,13,18,.15)' : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {seat.row_label}{seat.column_number}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
            {Object.entries(SEAT_COLORS).map(([key, sc]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: sc.bg, border: `1.5px solid ${sc.border}` }} />
                <span style={{ fontSize: 11, color: '#6B7689' }}>{sc.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Seat editor ────────────────────────────────────────────────────── */}
      {selected && (
        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A0D12' }}>
              Seat {selected.row_label}{selected.column_number}
            </div>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: BLUE_LIGHT, color: BLUE }}>
              Selected
            </span>
          </div>

          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #E2DDD4' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#3A4A5C' }}>
              Status: <span style={{ textTransform: 'capitalize', color: '#0A0D12' }}>{selected.live_status}</span>
            </div>
            <button
              onClick={handleToggle}
              disabled={isPending}
              style={{
                width: 40, height: 22, borderRadius: 11, border: 'none',
                background: selected.is_active ? ACCENT : '#C8D4C8',
                cursor: 'pointer', position: 'relative', transition: 'background .2s', marginLeft: 'auto',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3, left: selected.is_active ? 21 : 3,
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)',
              }} />
            </button>
            <span style={{ fontSize: 13, color: selected.is_active ? ACCENT : '#9AAAB8', fontWeight: 600 }}>
              {selected.is_active ? 'Active' : 'Inactive'}
            </span>
            <button
              onClick={() => setSelected(null)}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#6B7689',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Deselect
            </button>
          </div>

          {/* ── Current booking info (booked/held seats) ────────────────────── */}
          {selected.current_booking && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#F9F8F5', borderRadius: 10, border: '1px solid #E2DDD4', fontSize: 12, color: '#3A4A5C', lineHeight: 1.8 }}>
              <strong>{selected.current_booking.guest_name ?? 'Member'}</strong>
              {selected.current_booking.guest_phone && (
                <span style={{ color: '#9AAAB8', marginLeft: 8 }}>{selected.current_booking.guest_phone}</span>
              )}
              <br />
              {/* fmtIST: plain IST DB string → readable IST datetime */}
              📅 {fmtIST(selected.current_booking.start_time)} → {fmtIST(selected.current_booking.end_time)}
            </div>
          )}

          {/* ── Manual / Walk-in Booking (free seats only) ─────────────────── */}
          {selected.live_status === 'free' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0A0D12', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📋</span> Walk-in / Manual Booking
              </div>

              {/* Booking mode toggle */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 6 }}>Booking Channel</div>
                <div style={{ display: 'flex', gap: 0, borderRadius: 9, border: '1.5px solid #E2DDD4', overflow: 'hidden', width: 'fit-content' }}>
                  {(['offline', 'online'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setBookForm(f => ({ ...f, bookingMode: mode }))}
                      style={{
                        padding: '7px 20px', fontSize: 12, fontWeight: 700,
                        border: 'none', cursor: 'pointer',
                        background: bookForm.bookingMode === mode
                          ? (mode === 'offline' ? '#FEF3E2' : BLUE_LIGHT)
                          : '#FDFCF9',
                        color: bookForm.bookingMode === mode
                          ? (mode === 'offline' ? '#92400E' : BLUE)
                          : '#9AAAB8',
                        fontFamily: 'DM Sans, sans-serif',
                        borderRight: mode === 'offline' ? '1.5px solid #E2DDD4' : 'none',
                        transition: 'all .15s',
                      }}
                    >
                      {mode === 'offline' ? '🏪 Offline / Walk-in' : '🌐 Online / App'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#9AAAB8', marginTop: 5 }}>
                  {bookForm.bookingMode === 'offline'
                    ? 'Student is physically present — payment collected in person'
                    : 'Student booked via app or online — payment already processed'}
                </div>
              </div>

              {/* Student details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Student name *</div>
                  <input value={bookForm.userName}
                    onChange={e => setBookForm(f => ({ ...f, userName: e.target.value }))}
                    placeholder="e.g. Rahul Sharma" style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Phone number *</div>
                  <input value={bookForm.userPhone}
                    onChange={e => setBookForm(f => ({ ...f, userPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit mobile" inputMode="numeric" style={inp} />
                </div>
              </div>

              {/* Times — datetime-local values are already IST, stored as-is */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>
                    Start time <span style={{ color: ACCENT, fontWeight: 700 }}>IST</span> *
                  </div>
                  <input type="datetime-local"
                    value={bookForm.start}
                    onChange={e => setBookForm(f => ({ ...f, start: e.target.value }))}
                    style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>
                    End time <span style={{ color: ACCENT, fontWeight: 700 }}>IST</span> *
                  </div>
                  <input type="datetime-local"
                    value={bookForm.end}
                    onChange={e => setBookForm(f => ({ ...f, end: e.target.value }))}
                    style={inp} />
                </div>
              </div>

              {/* Offline payment section */}
              {bookForm.bookingMode === 'offline' && (
                <div style={{ background: '#F9F8F5', border: '1px solid #E2DDD4', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#3A4A5C', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    💵 Offline Payment Received
                    <span style={{ fontSize: 10, fontWeight: 500, color: '#9AAAB8' }}>(optional)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Amount (₹)</div>
                      <input
                        value={bookForm.amountPaid}
                        onChange={e => setBookForm(f => ({ ...f, amountPaid: e.target.value }))}
                        placeholder="0" inputMode="decimal" style={inp} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Mode</div>
                      <select
                        value={bookForm.paymentMode}
                        onChange={e => setBookForm(f => ({ ...f, paymentMode: e.target.value as any }))}
                        style={sel}
                      >
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Note / UPI ref</div>
                      <input
                        value={bookForm.paymentNote}
                        onChange={e => setBookForm(f => ({ ...f, paymentNote: e.target.value }))}
                        placeholder="e.g. UPI ref 12345" style={inp} />
                    </div>
                  </div>
                </div>
              )}

              {/* Summary preview — fmtInputPreview formats datetime-local "YYYY-MM-DDTHH:mm" as IST text */}
              {bookForm.userName && bookForm.start && bookForm.end && (
                <div style={{ background: ACCENT_LIGHT, border: `1px solid rgba(13,124,84,.2)`, borderRadius: 9, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#0A5E3F', lineHeight: 1.7 }}>
                  <strong>{bookForm.userName || '—'}</strong> · Seat {selected.row_label}{selected.column_number}<br />
                  <span style={{ fontWeight: 600 }}>📅</span> {fmtInputPreview(bookForm.start)} → {fmtInputPreview(bookForm.end)} IST
                  <br />
                  <span style={{ fontWeight: 600 }}>
                    {bookForm.bookingMode === 'offline' ? '🏪 Offline' : '🌐 Online'}
                  </span>
                  {bookForm.bookingMode === 'offline' && bookForm.amountPaid
                    ? ` · ₹${bookForm.amountPaid} via ${bookForm.paymentMode}`
                    : bookForm.bookingMode === 'offline' ? ' · No payment' : ''}
                </div>
              )}

              <button
                onClick={handleManualBook}
                disabled={isPending || !bookForm.userName || !bookForm.userPhone}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9,
                  fontSize: 13, fontWeight: 700, border: 'none',
                  background: bookForm.userName && bookForm.userPhone ? ACCENT : '#C8D4C8',
                  color: '#fff',
                  cursor: bookForm.userName && bookForm.userPhone ? 'pointer' : 'not-allowed',
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                {isPending ? 'Booking…' : `Confirm Booking — Seat ${selected.row_label}${selected.column_number}`}
              </button>
            </div>
          )}

          {/* ── Force-free (booked seats only) ────────────────────────────── */}
          {selected.live_status === 'booked' && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #E2DDD4' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0A0D12', marginBottom: 8 }}>🔓 Clear This Seat</div>
              <div style={{ fontSize: 12, color: '#6B7689', marginBottom: 12, lineHeight: 1.5 }}>
                Cancels the active booking in DB and marks seat as free. Payment record is kept for audit.
              </div>
              {!confirmForceFree ? (
                <button onClick={() => setConfirmForceFree(true)}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, border: `1.5px solid ${RED}`, background: RED_LIGHT, color: RED, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                  Force Free Seat {selected.row_label}{selected.column_number}
                </button>
              ) : (
                <div style={{ background: RED_LIGHT, border: `1.5px solid ${RED}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: RED, marginBottom: 10 }}>Are you sure? This will cancel the booking.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setConfirmForceFree(false)} disabled={isPending}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1.5px solid #E2DDD4', background: '#fff', color: '#3A4A5C', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                      Cancel
                    </button>
                    <button onClick={handleForceFree} disabled={isPending}
                      style={{ flex: 2, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none', background: RED, color: '#fff', cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
                      {isPending ? 'Clearing…' : 'Yes, Clear Seat'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Held notice ───────────────────────────────────────────────── */}
          {selected.live_status === 'held' && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #E2DDD4' }}>
              <div style={{ background: '#FEF3E2', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>⏳</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 3 }}>Seat held — checkout in progress</div>
                  <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, opacity: 0.85 }}>
                    A user is completing payment. Hold expires automatically if not paid.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add row panel ──────────────────────────────────────────────────── */}
      {showAddRow && (
        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12', marginBottom: 14 }}>Add New Row</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Row label (A–Z)</div>
              <input value={newRowLabel}
                onChange={e => setNewRowLabel(e.target.value.slice(0, 1).toUpperCase())}
                placeholder="e.g. G" maxLength={1} style={inp} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Number of seats</div>
              <input type="number" min={1} max={20} value={newRowCols}
                onChange={e => setNewRowCols(Number(e.target.value))} style={inp} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAddRow(false)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
              Cancel
            </button>
            <button onClick={handleAddRow} disabled={!newRowLabel || isPending}
              style={{ flex: 2, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 700, border: 'none', background: newRowLabel ? ACCENT : '#C8D4C8', color: '#fff', cursor: newRowLabel ? 'pointer' : 'not-allowed', fontFamily: 'Syne, sans-serif' }}>
              {isPending ? 'Adding…' : `Add Row ${newRowLabel || '?'} (${newRowCols} seats)`}
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
  input[type="datetime-local"]::-webkit-calendar-picker-indicator { cursor: pointer; }
`}} />
    </div>
  )
}