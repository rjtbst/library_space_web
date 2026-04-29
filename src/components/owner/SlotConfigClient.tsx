// src/app/(owner)/dashboard/slot-config/_components/SlotConfigClient.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SlotConfig, OwnerLibrary } from '@/lib/actions/owner'
import { upsertSlotConfig, toggleSlotConfig } from '@/lib/actions/owner'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const ACCENT_DARK  = '#0A5E3F'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const EMPTY_FORM = {
  start:     '09:00',
  end:       '12:00',
  days:      [0, 1, 2, 3, 4] as number[], // Mon–Fri selected by default
  price:     '',
  discount:  '',
}

function Toggle({
  on, onChange, disabled,
}: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        background: on ? ACCENT : '#C8D4C8',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background .2s', padding: 0,
        flexShrink: 0, opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3, left: on ? 19 : 3,
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)',
      }} />
    </button>
  )
}

function daysLabel(slot: SlotConfig) {
  return slot.days
}

function daysFromIndices(indices: number[]): string {
  if (indices.length === 7) return 'Mon–Sun'
  if (indices.length === 0) return 'No days'
  const sorted = [...indices].sort()
  // Group consecutive
  const groups: number[][] = []
  let group: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      group.push(sorted[i])
    } else {
      groups.push(group); group = [sorted[i]]
    }
  }
  groups.push(group)
  return groups.map(g =>
    g.length >= 3
      ? `${DAYS[g[0]]}–${DAYS[g[g.length - 1]]}`
      : g.map(i => DAYS[i]).join(', ')
  ).join(', ')
}

export default function SlotConfigClient({
  slots: initial, libraryId, libraryName, libraries,
}: {
  slots:       SlotConfig[]
  libraryId:   string
  libraryName: string
  libraries:   OwnerLibrary[]
}) {
  const router = useRouter()
  const [slots, setSlots]           = useState(initial)
  const [editing, setEditing]       = useState<SlotConfig | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [toast, setToast]           = useState('')
  const [error, setError]           = useState('')
  const [isPending, startTransition] = useTransition()

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(''), 2500)
  }

  /* ── open add form ── */
  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setShowForm(true)
  }

  /* ── open edit form ── */
  const openEdit = (slot: SlotConfig) => {
    // Parse stored days string back to indices
    const dayIndices = DAYS.map((_, i) => i).filter(i =>
      slot.days.includes(DAYS[i])
    )
    setEditing(slot)
    setForm({
      start:    slot.start,
      end:      slot.end,
      days:     dayIndices,
      price:    String(slot.price),
      discount: String(slot.discount || ''),
    })
    setError('')
    setShowForm(true)
    setTimeout(() => document.getElementById('slot-form')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  /* ── toggle day ── */
  const toggleDay = (idx: number) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(idx)
        ? f.days.filter(d => d !== idx)
        : [...f.days, idx],
    }))
  }

  /* ── save slot ── */
  const handleSave = () => {
    setError('')
    if (!form.start || !form.end) { setError('Start and end time are required'); return }
    if (form.days.length === 0) { setError('Select at least one day'); return }
    if (!form.price || isNaN(Number(form.price))) { setError('Enter a valid price'); return }
    if (form.start >= form.end) { setError('End time must be after start time'); return }

    const payload = {
      id:        editing?.id,
      start:     form.start,
      end:       form.end,
      days:      daysFromIndices(form.days),
      price:     Number(form.price),
      discount:  Number(form.discount || 0),
      is_active: editing?.is_active ?? true,
    }

    startTransition(async () => {
      const res = await upsertSlotConfig(libraryId, payload)
      if (res.success === false) { setError(res.error); return }

      // Optimistic update
      if (editing) {
        setSlots(prev => prev.map(s => s.id === editing.id ? { ...s, ...payload, id: editing.id } : s))
        showToast('Slot updated')
      } else {
        // Reload to get the new id from server
        router.refresh()
        showToast('Slot added')
      }
      setShowForm(false)
      setEditing(null)
    })
  }

  /* ── toggle active ── */
  const handleToggle = (slot: SlotConfig, val: boolean) => {
    startTransition(async () => {
      const res = await toggleSlotConfig(libraryId, slot.id, val)
      if (res.success) {
        setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, is_active: val } : s))
        showToast(`Slot ${val ? 'enabled' : 'disabled'}`)
      }
    })
  }

  const inpStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid #E2DDD4', borderRadius: 9,
    fontSize: 13, color: '#0A0D12', outline: 'none',
    fontFamily: 'DM Sans, sans-serif', background: '#FDFCF9',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>

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
            Slot Configuration
          </h1>
          <div style={{ fontSize: 13, color: '#6B7689' }}>{libraryName} · Set time slots and pricing</div>
        </div>
        <button
          onClick={openAdd}
          style={{
            padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', boxShadow: '0 2px 10px rgba(13,124,84,.25)',
          }}
        >
          + Add Slot
        </button>
      </div>

      {/* Library selector */}
      {libraries.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {libraries.map(lib => (
            <button
              key={lib.id}
              onClick={() => router.push(`/owner/dashboard/slot-config?lib=${lib.id}`)}
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

      {/* Slots table */}
      <div style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}>
        {slots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 0', color: '#9AAAB8' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⏰</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#3A4A5C' }}>No slots configured yet</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Add your first time slot to define when students can book</div>
            <button
              onClick={openAdd}
              style={{
                padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              + Add First Slot
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Time Slot', 'Days', 'Price / hr', 'Last-min Discount', 'Status', ''].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 16px',
                      fontSize: 11, fontWeight: 700, color: '#9AAAB8',
                      textTransform: 'uppercase', letterSpacing: '.05em',
                      borderBottom: '1px solid #E2DDD4', background: '#F9F8F5',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr
                    key={slot.id}
                    style={{ borderBottom: '1px solid #F0EDE8' }}
                  >
                    <td style={{ padding: '13px 16px', fontWeight: 700, color: '#0A0D12', whiteSpace: 'nowrap' }}>
                      {slot.start} – {slot.end}
                    </td>
                    <td style={{ padding: '13px 16px', color: '#6B7689' }}>
                      {slot.days}
                    </td>
                    <td style={{ padding: '13px 16px', fontWeight: 700, color: '#0A0D12' }}>
                      ₹{slot.price}
                    </td>
                    <td style={{ padding: '13px 16px', color: slot.discount ? '#0A0D12' : '#9AAAB8' }}>
                      {slot.discount ? `₹${slot.discount} off` : 'No discount'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <Toggle
                        on={slot.is_active}
                        onChange={v => handleToggle(slot, v)}
                        disabled={isPending}
                      />
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <button
                        onClick={() => openEdit(slot)}
                        style={{
                          padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                          border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div
          id="slot-form"
          style={{ background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14, padding: '22px 24px', boxShadow: '0 2px 8px rgba(10,13,18,.04)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0A0D12' }}>
              {editing ? `Edit Slot — ${editing.start} – ${editing.end}` : 'Add New Slot'}
            </div>
            <button
              onClick={() => { setShowForm(false); setEditing(null) }}
              style={{
                width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #E2DDD4',
                background: '#FDFCF9', color: '#6B7689', cursor: 'pointer', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>

          {/* Time row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', display: 'block', marginBottom: 5 }}>
                Start time
              </label>
              <input
                type="time" value={form.start}
                onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                style={inpStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', display: 'block', marginBottom: 5 }}>
                End time
              </label>
              <input
                type="time" value={form.end}
                onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                style={inpStyle}
              />
            </div>
          </div>

          {/* Day chips */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', display: 'block', marginBottom: 8 }}>
              Active days
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((day, idx) => {
                const on = form.days.includes(idx)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    style={{
                      width: 40, height: 40, borderRadius: 9,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${on ? BLUE : '#E2DDD4'}`,
                      background: on ? BLUE_LIGHT : '#F9F8F5',
                      color: on ? BLUE : '#9AAAB8',
                      transition: 'all .12s',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Price row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', display: 'block', marginBottom: 5 }}>
                Base price / hr (₹) *
              </label>
              <input
                type="number" min="0" placeholder="25"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                style={inpStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7689', display: 'block', marginBottom: 5 }}>
                Last-minute discount (₹, optional)
              </label>
              <input
                type="number" min="0" placeholder="e.g. 5"
                value={form.discount}
                onChange={e => setForm(f => ({ ...f, discount: e.target.value }))}
                style={inpStyle}
              />
            </div>
          </div>

          {/* Preview */}
          {form.price && form.start && form.end && (
            <div style={{
              background: ACCENT_LIGHT, border: `1px solid rgba(13,124,84,.2)`,
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
              fontSize: 12, color: '#0A5E3F',
            }}>
              <strong>Preview:</strong> {form.start}–{form.end} · {daysFromIndices(form.days)} · ₹{form.price}/hr
              {form.discount ? ` · ₹${form.discount} last-min discount` : ''}
            </div>
          )}

          {error && (
            <div style={{
              background: '#FDEAEA', border: '1px solid rgba(212,43,43,.2)',
              borderRadius: 9, padding: '9px 14px', marginBottom: 14,
              fontSize: 13, color: '#9B1C1C', display: 'flex', gap: 8,
            }}>
              <span>⚠️</span> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setShowForm(false); setEditing(null) }}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
                border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              style={{
                flex: 2, padding: '11px 0', borderRadius: 9, fontSize: 14, fontWeight: 700,
                border: 'none', background: ACCENT, color: '#fff',
                cursor: isPending ? 'not-allowed' : 'pointer',
                fontFamily: 'Syne, sans-serif',
                boxShadow: '0 2px 10px rgba(13,124,84,.25)',
                opacity: isPending ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isPending && (
                <span style={{
                  width: 14, height: 14, border: '2px solid rgba(255,255,255,.35)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  display: 'inline-block', animation: 'spin .65s linear infinite',
                }} />
              )}
              {isPending ? 'Saving…' : editing ? 'Update Slot' : 'Save Slot'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }
        @keyframes spin   { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}