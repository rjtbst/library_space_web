'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SeatRow, OwnerLibrary } from '@/lib/actions/owner'
import { toggleSeatActive, addSeatRow } from '@/lib/actions/owner'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'

const SEAT_COLORS: Record<string, { bg: string; border: string; color: string; label: string }> = {
  free:     { bg: '#F0FDF4', border: '#86EFAC',   color: ACCENT,    label: 'Free'     },
  booked:   { bg: BLUE_LIGHT, border: '#93C5FD',  color: BLUE,      label: 'Booked'   },
  held:     { bg: '#FEF3E2', border: '#FCD34D',   color: '#92400E', label: 'Held'     },
  inactive: { bg: '#F4F7FB', border: '#E2DDD4',   color: '#9AAAB8', label: 'Inactive' },
}

export default function SeatManagerClient({
  seats: initial, libraryId, libraryName, libraries,
}: {
  seats:       SeatRow[]
  libraryId:   string
  libraryName: string
  libraries:   OwnerLibrary[]
}) {
  const router = useRouter()
  const [seats, setSeats]           = useState(initial)
  const [selected, setSelected]     = useState<SeatRow | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showAddRow, setShowAddRow] = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('')
  const [newRowCols, setNewRowCols]   = useState(8)
  const [toast, setToast]             = useState('')

  // Group seats by row
  const rows = Array.from(new Set(seats.map(s => s.row_label))).sort()

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

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

  // Stats
  const active   = seats.filter(s => s.is_active).length
  const booked   = seats.filter(s => s.live_status === 'booked').length
  const inactive = seats.filter(s => !s.is_active).length

  const inpStyle = {
    padding: '9px 12px', border: '1.5px solid #E2DDD4', borderRadius: 9,
    fontSize: 13, color: '#0A0D12', outline: 'none',
    fontFamily: 'DM Sans, sans-serif', background: '#FDFCF9',
    boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          background: '#0A0D12', color: '#fff', padding: '10px 18px',
          borderRadius: 10, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.2)',
          animation: 'fadeIn .2s ease',
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
          <div style={{ fontSize: 13, color: '#6B7689' }}>{libraryName} · {seats.length} seats configured</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
      </div>

      {/* Library picker */}
      {libraries.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {libraries.map(lib => (
            <button
              key={lib.id}
              onClick={() => router.push(`/owner/dashboard/seat-manager?lib=${lib.id}`)}
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
          Click any seat to select · Toggle active/inactive below the grid
        </span>
      </div>

      {/* Floor grid card */}
      <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
        {/* Card header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #E2DDD4' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12' }}>Floor Layout</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { label: `${active} active`,   bg: ACCENT_LIGHT, color: ACCENT    },
              { label: `${booked} booked`,   bg: BLUE_LIGHT,   color: BLUE      },
              { label: `${inactive} off`,    bg: '#F4F7FB',    color: '#9AAAB8' },
            ].map(({ label, bg, color }) => (
              <span key={label} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color }}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div style={{ padding: '16px', overflowX: 'auto' }}>
          {seats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9AAAB8' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💺</div>
              <div>No seats configured yet. Add a row to get started.</div>
            </div>
          ) : rows.map(row => {
            const rowSeats = seats.filter(s => s.row_label === row).sort((a, b) => a.column_number - b.column_number)
            return (
              <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                {/* Row label */}
                <div style={{
                  width: 24, height: 24, borderRadius: 6, background: '#F4F7FB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#6B7689', flexShrink: 0,
                }}>
                  {row}
                </div>

                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {rowSeats.map((seat, idx) => {
                    const sc = SEAT_COLORS[seat.live_status]
                    const isSelected = selected?.id === seat.id
                    // Aisle gap after seat 4
                    return (
                      <>
                        {idx === 4 && (
                          <div key="gap" style={{ width: 10 }} />
                        )}
                        <button
                          key={seat.id}
                          onClick={() => setSelected(seat.id === selected?.id ? null : seat)}
                          style={{
                            width: 38, height: 38, borderRadius: 7,
                            background: sc.bg,
                            border: `2px solid ${isSelected ? '#0A0D12' : sc.border}`,
                            color: sc.color,
                            fontSize: 10, fontWeight: 700,
                            cursor: 'pointer', transition: 'all .12s',
                            boxShadow: isSelected ? '0 0 0 3px rgba(10,13,18,.15)' : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {seat.row_label}{seat.column_number}
                        </button>
                      </>
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

      {/* Seat editor */}
      {selected && (
        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A0D12' }}>
              Edit Seat — {selected.row_label}{selected.column_number}
            </div>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: BLUE_LIGHT, color: BLUE }}>
              Selected
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Seat ID</div>
              <div style={{ ...inpStyle, color: '#9AAAB8', background: '#F4F7FB' }}>
                {selected.row_label}{selected.column_number}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Live Status</div>
              <div style={{ ...inpStyle, color: '#9AAAB8', background: '#F4F7FB', textTransform: 'capitalize' }}>
                {selected.live_status}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #E2DDD4' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#3A4A5C' }}>Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleToggle}
                disabled={isPending}
                style={{
                  width: 40, height: 22, borderRadius: 11, border: 'none',
                  background: selected.is_active ? ACCENT : '#C8D4C8',
                  cursor: 'pointer', position: 'relative', transition: 'background .2s',
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
            </div>
            <button
              onClick={() => setSelected(null)}
              style={{
                marginLeft: 'auto', padding: '6px 14px', borderRadius: 8,
                fontSize: 12, fontWeight: 600, border: '1.5px solid #E2DDD4',
                background: '#FDFCF9', color: '#6B7689', cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* Add row panel */}
      {showAddRow && (
        <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A0D12', marginBottom: 14 }}>Add New Row</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Row label (A–Z)</div>
              <input
                value={newRowLabel}
                onChange={e => setNewRowLabel(e.target.value.slice(0, 1).toUpperCase())}
                placeholder="e.g. G"
                style={{ ...inpStyle, width: '100%' }}
                maxLength={1}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', marginBottom: 5 }}>Number of seats</div>
              <input
                type="number" min={1} max={20}
                value={newRowCols}
                onChange={e => setNewRowCols(Number(e.target.value))}
                style={{ ...inpStyle, width: '100%' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowAddRow(false)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
                border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddRow}
              disabled={!newRowLabel || isPending}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 9, fontSize: 14, fontWeight: 700,
                border: 'none', background: newRowLabel ? ACCENT : '#C8D4C8', color: '#fff',
                cursor: newRowLabel ? 'pointer' : 'not-allowed', fontFamily: 'Syne, sans-serif',
              }}
            >
              {isPending ? 'Adding…' : `Add Row ${newRowLabel || '?'} (${newRowCols} seats)`}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
      `}</style>
    </div>
  )
}

const inpStyle = {
  padding: '9px 12px', border: '1.5px solid #E2DDD4', borderRadius: 9,
  fontSize: 13, color: '#0A0D12', outline: 'none',
  fontFamily: 'DM Sans, sans-serif', background: '#FDFCF9',
  display: 'block',
}