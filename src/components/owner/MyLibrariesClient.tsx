// src/app/(owner)/dashboard/my-libraries/_components/MyLibrariesClient.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { OwnerLibrary } from '@/lib/actions/owner'
import { toggleLibraryActive } from '@/lib/actions/owner'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'
const BLUE         = '#1E5CFF'
const BLUE_LIGHT   = '#E8EFFE'

const GRADIENTS = [
  'linear-gradient(135deg,#E0E8FF,#C7D4F7)',
  'linear-gradient(135deg,#D4EDD4,#B8DDB8)',
  'linear-gradient(135deg,#F0E8FF,#DDD0F7)',
  'linear-gradient(135deg,#FFE8D4,#F7C7A4)',
  'linear-gradient(135deg,#D4F0FF,#A4D4F7)',
]
const EMOJIS = ['📚', '🌿', '📖', '🏛️', '📗']

function fmtCurrency(n: number) {
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`
  return `₹${n}`
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        background: on ? ACCENT : '#C8D4C8', cursor: 'pointer',
        position: 'relative', transition: 'background .2s', padding: 0,
        flexShrink: 0,
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

export default function MyLibrariesClient({
  libraries: initial, totalRev, totalMembers, avgOcc,
}: {
  libraries:     OwnerLibrary[]
  totalRev:      number
  totalMembers:  number
  avgOcc:        number
}) {
  const router = useRouter()
  const [libraries, setLibraries] = useState(initial)
  const [isPending, startTransition] = useTransition()

  const handleToggle = (libId: string, newVal: boolean) => {
    startTransition(async () => {
      const res = await toggleLibraryActive(libId, newVal)
      if (res.success) {
        setLibraries(prev => prev.map(l => l.id === libId ? { ...l, is_active: newVal } : l))
      }
    })
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color: '#0A0D12', letterSpacing: '-0.03em', margin: 0, marginBottom: 4 }}>
            My Libraries
          </h1>
          <div style={{ fontSize: 13, color: '#6B7689' }}>All your registered libraries</div>
        </div>
        <button
          onClick={() => router.push('/onboarding/add-library')}
          style={{
            padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'Syne, sans-serif', boxShadow: '0 2px 10px rgba(13,124,84,.25)',
          }}
        >
          + Add New Library
        </button>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Libraries',     value: String(libraries.length) },
          { label: 'This Month',    value: fmtCurrency(totalRev)    },
          { label: 'Members',       value: String(totalMembers)      },
          { label: 'Avg Occupancy', value: `${avgOcc}%`              },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: '#FDFCF9', border: '1px solid #E2DDD4',
            borderRadius: 12, padding: '14px 16px',
            boxShadow: '0 2px 6px rgba(10,13,18,.04)',
          }}>
            <div style={{ fontSize: 10, color: '#9AAAB8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Library cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {libraries.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            background: '#FDFCF9', borderRadius: 14, border: '1px solid #E2DDD4',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏛️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0A0D12', marginBottom: 6 }}>No libraries yet</div>
            <div style={{ fontSize: 13, color: '#6B7689', marginBottom: 20 }}>Add your first library to get started</div>
            <button
              onClick={() => router.push('/onboarding/add-library')}
              style={{
                padding: '10px 20px', borderRadius: 9, fontSize: 14, fontWeight: 700,
                background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: 'Syne, sans-serif',
              }}
            >
              + Add Library
            </button>
          </div>
        ) : libraries.map((lib, idx) => (
          <div
            key={lib.id}
            style={{
              background: '#FDFCF9', border: '1px solid #E2DDD4', borderRadius: 14,
              padding: '18px 20px', boxShadow: '0 2px 8px rgba(10,13,18,.04)',
              transition: 'box-shadow .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 6px 24px rgba(10,13,18,.10)')}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(10,13,18,.04)')}
          >
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Icon / cover */}
              <div style={{
                width: 64, height: 64, borderRadius: 12, flexShrink: 0,
                background: lib.cover_url ? `url(${lib.cover_url}) center/cover` : GRADIENTS[idx % GRADIENTS.length],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28,
              }}>
                {!lib.cover_url && EMOJIS[idx % EMOJIS.length]}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#0A0D12' }}>{lib.name}</span>
                  <span style={{
                    padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: lib.is_active ? ACCENT_LIGHT : '#F0EDE8',
                    color: lib.is_active ? ACCENT : '#9AAAB8',
                  }}>
                    {lib.is_active ? '● Live' : '○ Inactive'}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#9AAAB8' }}>{lib.is_active ? 'Active' : 'Paused'}</span>
                    <Toggle on={lib.is_active} onChange={v => handleToggle(lib.id, v)} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#6B7689', marginBottom: 12 }}>
                  📍 {[lib.area, lib.city].filter(Boolean).join(', ')}
                </div>

                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Seats',          value: `${lib.active_seats}/${lib.total_seats}` },
                    { label: 'Revenue/month',  value: fmtCurrency(lib.month_revenue), color: BLUE },
                    { label: 'Members',        value: String(lib.member_count) },
                    { label: 'Staff',          value: String(lib.staff_count)  },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: '#9AAAB8', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: color ?? '#0A0D12' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => router.push(`/owner/dashboard/seat-manager?lib=${lib.id}`)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Seat Manager
                </button>
                <button
                  onClick={() => router.push(`/owner/dashboard/slot-config?lib=${lib.id}`)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: '1.5px solid #E2DDD4', background: '#FDFCF9', color: '#3A4A5C',
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Slot Config
                </button>
                <button
                  onClick={() => router.push(`/owner/dashboard?lib=${lib.id}`)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: 'none', background: ACCENT, color: '#fff',
                    cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                  }}
                >
                  Dashboard →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}