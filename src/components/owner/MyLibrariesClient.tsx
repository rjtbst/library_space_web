'use client'
import { useState, useTransition, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OwnerLibrary } from '@/lib/actions/owner'
import { toggleLibraryActive } from '@/lib/actions/owner'
import {
  ACCENT, ACCENT_LIGHT, BLUE, BLUE_LIGHT,
  BORDER, BG_CARD, SHADOW_SM, FONT_DISPLAY, FONT_BODY,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
} from '@/lib/constants/theme'
import { fmtCurrency } from '@/lib/utils/format'
import { Toggle, Card, PageHeader, EmptyState, Toast } from '@/components/owner/ui'
import { useToast } from '@/hooks/useToast'

const GRADIENTS = [
  'linear-gradient(135deg,#E0E8FF,#C7D4F7)',
  'linear-gradient(135deg,#D4EDD4,#B8DDB8)',
  'linear-gradient(135deg,#F0E8FF,#DDD0F7)',
  'linear-gradient(135deg,#FFE8D4,#F7C7A4)',
  'linear-gradient(135deg,#D4F0FF,#A4D4F7)',
]
const EMOJIS = ['📚', '🌿', '📖', '🏛️', '📗']

const NAV_BTN_STYLE: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  border: `1.5px solid ${BORDER}`, background: BG_CARD, color: '#3A4A5C',
  cursor: 'pointer', fontFamily: FONT_BODY,
}

export default function MyLibrariesClient({ libraries: initial }: { libraries: OwnerLibrary[] }) {
  const router = useRouter()
  const { toast, showToast } = useToast()
  const [libraries, setLibraries]    = useState(initial)
  const [isPending, startTransition] = useTransition()

  // ← summary stats computed here (moved from page.tsx)
  const summary = useMemo(() => ({
    totalRev:     libraries.reduce((s, l) => s + l.month_revenue, 0),
    totalMembers: libraries.reduce((s, l) => s + l.member_count,  0),
    avgOcc: libraries.length
      ? Math.round(
          libraries.reduce((s, l) => s + (l.total_seats ? l.active_seats / l.total_seats : 0), 0)
          / libraries.length * 100
        )
      : 0,
  }), [libraries])

  const handleToggle = useCallback((libId: string, newVal: boolean) => {
    startTransition(async () => {
      const res = await toggleLibraryActive(libId, newVal)
      if (res.success) {
        setLibraries(prev => prev.map(l => l.id === libId ? { ...l, is_active: newVal } : l))
        showToast(`Library ${newVal ? 'activated' : 'paused'}`)
      }
    })
  }, [showToast])

  // Trigger progress bar + navigate — used for all action buttons
  const navigate = useCallback((href: string) => {
    ;(window as any).__startNavProgress?.()
    router.push(href)
  }, [router])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000 }}>
      <Toast toast={toast} />

      <PageHeader
        title="My Libraries"
        subtitle="All your registered libraries"
        action={
          <button
            onClick={() => navigate('/onboarding/add-library')}
            style={{
              padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
              background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: FONT_DISPLAY, boxShadow: '0 2px 10px rgba(13,124,84,.25)',
            }}
          >
            + Add New Library
          </button>
        }
      />

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Libraries',     value: String(libraries.length)          },
          { label: 'This Month',    value: fmtCurrency(summary.totalRev)     },
          { label: 'Members',       value: String(summary.totalMembers)       },
          { label: 'Avg Occupancy', value: `${summary.avgOcc}%`              },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: BG_CARD, border: `1px solid ${BORDER}`,
            borderRadius: 12, padding: '14px 16px', boxShadow: SHADOW_SM,
          }}>
            <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: FONT_DISPLAY, color: TEXT_PRIMARY }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Library cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {libraries.length === 0 ? (
          <Card>
            <EmptyState
              icon="🏛️"
              title="No libraries yet"
              subtitle="Add your first library to get started"
              action={
                <button
                  onClick={() => navigate('/onboarding/add-library')}
                  style={{
                    padding: '10px 20px', borderRadius: 9, fontSize: 14, fontWeight: 700,
                    background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                    fontFamily: FONT_DISPLAY,
                  }}
                >
                  + Add Library
                </button>
              }
            />
          </Card>
        ) : libraries.map((lib, idx) => (
          <Card key={lib.id} hoverable padding="18px 20px">
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Cover / icon */}
              <div style={{
                width: 64, height: 64, borderRadius: 12, flexShrink: 0,
                background: lib.cover_url
                  ? `url(${lib.cover_url}) center/cover`
                  : GRADIENTS[idx % GRADIENTS.length],
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              }}>
                {!lib.cover_url && EMOJIS[idx % EMOJIS.length]}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY }}>{lib.name}</span>
                  <span style={{
                    padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: lib.is_active ? ACCENT_LIGHT : '#F0EDE8',
                    color: lib.is_active ? ACCENT : TEXT_MUTED,
                  }}>
                    {lib.is_active ? '● Live' : '○ Inactive'}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: TEXT_MUTED }}>{lib.is_active ? 'Active' : 'Paused'}</span>
                    <Toggle
                      on={lib.is_active}
                      onChange={v => handleToggle(lib.id, v)}
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginBottom: 12 }}>
                  📍 {[lib.area, lib.city].filter(Boolean).join(', ')}
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Seats',         value: `${lib.active_seats}/${lib.total_seats}` },
                    { label: 'Revenue/month', value: fmtCurrency(lib.month_revenue), color: BLUE },
                    { label: 'Members',       value: String(lib.member_count) },
                    { label: 'Staff',         value: String(lib.staff_count)  },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: color ?? TEXT_PRIMARY }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons — all trigger progress bar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                <button onClick={() => navigate(`/dashboard/seat-manager?lib=${lib.id}`)} style={NAV_BTN_STYLE}>
                  Seat Manager
                </button>
                <button onClick={() => navigate(`/dashboard/slot-config?lib=${lib.id}`)} style={NAV_BTN_STYLE}>
                  Slot Config
                </button>
                <button
                  onClick={() => navigate(`/dashboard?lib=${lib.id}`)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: 'none', background: ACCENT, color: '#fff',
                    cursor: 'pointer', fontFamily: FONT_DISPLAY,
                  }}
                >
                  Dashboard →
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}