'use client'
import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanWithStats } from '@/lib/actions/owner'
import { createPlan, archivePlan } from '@/lib/actions/owner'
import { useOwner } from '@/contexts/OwnerContext'
import { useToast } from '@/hooks/useToast'
import {
  ACCENT, ACCENT_LIGHT, BLUE, BLUE_LIGHT, BLUE_DARK,
  PURPLE, TEAL, FONT_DISPLAY, FONT_BODY,
  BG_CARD, BORDER, SHADOW_SM, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  INP_STYLE,
} from '@/lib/constants/theme'
import { Card, PageHeader, EmptyState, Toast, Spinner, ErrorBanner } from '@/components/owner/ui'

const PLAN_COLORS = [TEAL, BLUE, PURPLE, ACCENT, '#F59E0B', '#EF4444']

const DURATION_OPTIONS = [
  { label: '7 days',  value: 7  },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]
const QUOTA_OPTIONS = ['Unlimited', '1 session/day', '2 sessions/day', '20 sessions total']

const EMPTY_FORM = {
  name: '', price: '', duration_days: 30,
  session_limit: 'Unlimited',
  scope: 'library' as 'library' | 'cross',
  library_ids: [] as string[],
}

/* ─── PlanCard — extracted to avoid re-rendering siblings on archive ───────── */
function PlanCard({
  plan, color, onArchive, archiving,
}: {
  plan: PlanWithStats; color: string
  onArchive: (id: string) => void; archiving: boolean
}) {
  const [confirmArchive, setConfirmArchive] = useState(false)
  const barPct = Math.min(100, Math.round((plan.subscriber_count / 100) * 100))

  return (
    <Card style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 2 }}>{plan.name}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            ₹{plan.price.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>
            {plan.duration_days} days · {plan.session_limit ?? 'Unlimited'}
          </div>
        </div>
        <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ACCENT_LIGHT, color: ACCENT }}>
          ● Active
        </span>
      </div>

      <div style={{ height: 1, background: BORDER, marginBottom: 12 }} />

      {/* Scope */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: TEXT_MUTED, marginBottom: 5 }}>Scope</div>
        <span style={{
          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
          background: plan.scope === 'cross' ? ACCENT_LIGHT : BLUE_LIGHT,
          color:      plan.scope === 'cross' ? ACCENT : BLUE,
        }}>
          {plan.scope === 'cross' ? '🔗 Cross-library (all branches)' : '🏛️ Library-specific'}
        </span>
      </div>

      {/* Active at */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: TEXT_MUTED, marginBottom: 5 }}>Active at</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {plan.libraries.length > 0 ? plan.libraries.map(lib => (
            <span key={lib.id} style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 500,
              background: '#F4F7FB', color: '#3A4A5C', border: `1px solid ${BORDER}`,
            }}>
              {lib.name}
            </span>
          )) : <span style={{ fontSize: 11, color: TEXT_MUTED }}>No libraries linked</span>}
        </div>
      </div>

      {/* Subscriber bar */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#3A4A5C' }}>{plan.subscriber_count} subscribers</span>
        <div style={{ background: '#F4F7FB', borderRadius: 5, height: 5, overflow: 'hidden', marginTop: 5 }}>
          <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 5, background: color, transition: 'width .4s ease' }} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        {confirmArchive ? (
          <>
            <span style={{ fontSize: 12, color: '#9B1C1C', alignSelf: 'center', flex: 1 }}>Archive this plan?</span>
            <button onClick={() => setConfirmArchive(false)} style={{
              padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${BORDER}`, background: BG_CARD, color: '#3A4A5C', cursor: 'pointer', fontFamily: FONT_BODY,
            }}>Cancel</button>
            <button disabled={archiving} onClick={() => onArchive(plan.id)} style={{
              padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              border: 'none', background: '#C5282C', color: '#fff', cursor: 'pointer',
              fontFamily: FONT_BODY, opacity: archiving ? 0.7 : 1,
            }}>
              {archiving ? '…' : 'Confirm'}
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmArchive(true)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1.5px solid #FCA5A5', background: '#FEE2E2', color: '#9B1C1C',
            cursor: 'pointer', fontFamily: FONT_BODY,
          }}>
            Archive
          </button>
        )}
      </div>
    </Card>
  )
}

/* ─── Main ──────────────────────────────────────────────────────────────────── */
export default function PlanBuilderClient({ plans: initial }: { plans: PlanWithStats[] }) {
  const { libraries } = useOwner()          // ← from context, no prop / no DB call
  const router = useRouter()
  const { toast, showToast } = useToast()

  const [plans, setPlans]             = useState(initial)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [showForm, setShowForm]       = useState(false)
  const [error, setError]             = useState('')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  const toggleLibrary = useCallback((id: string) => {
    setForm(f => ({
      ...f,
      library_ids: f.library_ids.includes(id)
        ? f.library_ids.filter(l => l !== id)
        : [...f.library_ids, id],
    }))
  }, [])

  const setScope = useCallback((scope: 'library' | 'cross') => {
    setForm(f => ({
      ...f, scope,
      library_ids: scope === 'cross' ? libraries.map(l => l.id) : f.library_ids,
    }))
  }, [libraries])

  const handleCreate = useCallback(() => {
    setError('')
    if (!form.name.trim())                                          { setError('Plan name is required'); return }
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) { setError('Enter a valid price'); return }
    if (form.library_ids.length === 0)                              { setError('Select at least one library'); return }

    startTransition(async () => {
      const res = await createPlan({
        name:          form.name.trim(),
        price:         Number(form.price),
        duration_days: form.duration_days,
        session_limit: form.session_limit === 'Unlimited' ? undefined : form.session_limit,
        scope:         form.scope,
        library_ids:   form.library_ids,
      })
      if (res.success === false) { setError(res.error); return }
      showToast('Plan created!')
      setShowForm(false)
      setForm(EMPTY_FORM)
      router.refresh()
    })
  }, [form, showToast, router])

  const handleArchive = useCallback((planId: string) => {
    setArchivingId(planId)
    startTransition(async () => {
      const res = await archivePlan(planId)
      setArchivingId(null)
      if (res.success) {
        setPlans(prev => prev.filter(p => p.id !== planId))
        showToast('Plan archived')
      }
    })
  }, [showToast])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 960 }}>
      <Toast toast={toast} />

      <PageHeader
        title="Plan Builder"
        subtitle="Create membership plans — assign per-library or share across all"
        action={
          <button
            onClick={() => { setShowForm(v => !v); setError('') }}
            style={{
              padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
              background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
              fontFamily: FONT_DISPLAY, boxShadow: '0 2px 10px rgba(13,124,84,.25)',
            }}
          >
            {showForm ? '✕ Cancel' : '+ New Plan'}
          </button>
        }
      />

      {/* Info banner */}
      <div style={{
        background: BLUE_LIGHT, border: `1px solid rgba(30,92,255,.2)`,
        borderRadius: 12, padding: '11px 14px', marginBottom: 20,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
        <p style={{ fontSize: 13, color: BLUE_DARK, margin: 0, lineHeight: 1.5 }}>
          Plans can be <strong>Library-specific</strong> (one library only) or{' '}
          <strong>Cross-library</strong> (all your libraries). Set this per plan.
        </p>
      </div>

      {/* Plans grid */}
      {plans.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 20 }}>
          {plans.map((plan, idx) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              color={PLAN_COLORS[idx % PLAN_COLORS.length]}
              onArchive={handleArchive}
              archiving={archivingId === plan.id}
            />
          ))}
        </div>
      )}

      {plans.length === 0 && !showForm && (
        <Card>
          <EmptyState
            icon="🎯"
            title="No plans yet"
            subtitle="Create membership plans so students can subscribe to your library"
            action={
              <button
                onClick={() => setShowForm(true)}
                style={{
                  padding: '10px 22px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                  background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: FONT_DISPLAY,
                }}
              >
                + Create First Plan
              </button>
            }
          />
        </Card>
      )}

      {/* Create form */}
      {showForm && (
        <Card padding="22px 24px">
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 18 }}>Create New Plan</div>

          {/* Name + Price */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 5 }}>Plan name *</label>
              <input type="text" placeholder="e.g. Regular Monthly" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={INP_STYLE} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 5 }}>Price (₹ / month) *</label>
              <input type="number" placeholder="699" min="1" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))} style={INP_STYLE} />
            </div>
          </div>

          {/* Duration + Quota */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 5 }}>Duration</label>
              <select value={form.duration_days}
                onChange={e => setForm(f => ({ ...f, duration_days: Number(e.target.value) }))}
                style={{ ...INP_STYLE, cursor: 'pointer', appearance: 'none' }}>
                {DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 5 }}>Session quota</label>
              <select value={form.session_limit}
                onChange={e => setForm(f => ({ ...f, session_limit: e.target.value }))}
                style={{ ...INP_STYLE, cursor: 'pointer', appearance: 'none' }}>
                {QUOTA_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Scope toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 8 }}>Plan Scope *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([
                { value: 'library', icon: '🏛️', title: 'Library-specific', sub: 'Student uses at selected library only' },
                { value: 'cross',   icon: '🔗', title: 'Cross-library',    sub: 'Student uses at all your libraries'  },
              ] as const).map(opt => {
                const active = form.scope === opt.value
                return (
                  <button key={opt.value} type="button" onClick={() => setScope(opt.value)} style={{
                    padding: '12px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    border: `${active ? 2 : 1.5}px solid ${active ? BLUE : BORDER}`,
                    background: active ? BLUE_LIGHT : '#F9F8F5',
                    fontFamily: FONT_BODY, transition: 'all .12s',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: active ? BLUE_DARK : '#3A4A5C', marginBottom: 3 }}>
                      {opt.icon} {opt.title}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_MUTED }}>{opt.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Library checkboxes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 8 }}>Applicable Libraries *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {libraries.map(lib => {
                const checked = form.library_ids.includes(lib.id)
                return (
                  <button key={lib.id} type="button"
                    onClick={() => form.scope !== 'cross' && toggleLibrary(lib.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 9, textAlign: 'left',
                      cursor: form.scope === 'cross' ? 'default' : 'pointer',
                      border: `1.5px solid ${checked ? BLUE : BORDER}`,
                      background: checked ? BLUE_LIGHT : '#F9F8F5',
                      fontFamily: FONT_BODY, transition: 'all .12s',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>📚</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? BLUE_DARK : '#3A4A5C' }}>
                      {lib.name}
                    </span>
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${checked ? BLUE : BORDER}`,
                      background: checked ? BLUE : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, color: '#fff',
                    }}>
                      {checked && '✓'}
                    </div>
                  </button>
                )
              })}
            </div>
            {form.scope === 'cross' && (
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 6 }}>
                All libraries selected automatically for cross-library plans.
              </div>
            )}
          </div>

          <ErrorBanner error={error} />

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setShowForm(false); setError('') }} style={{
              flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
              border: `1.5px solid ${BORDER}`, background: BG_CARD, color: '#3A4A5C',
              cursor: 'pointer', fontFamily: FONT_BODY,
            }}>Cancel</button>
            <button onClick={handleCreate} disabled={isPending} style={{
              flex: 2, padding: '11px 0', borderRadius: 9, fontSize: 14, fontWeight: 700,
              border: 'none', background: ACCENT, color: '#fff',
              cursor: isPending ? 'not-allowed' : 'pointer', fontFamily: FONT_DISPLAY,
              boxShadow: '0 2px 10px rgba(13,124,84,.25)', opacity: isPending ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {isPending && <Spinner />}
              {isPending ? 'Creating…' : 'Create Plan'}
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}