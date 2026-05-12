import { BG_CARD, BORDER, SHADOW_SM, FONT_DISPLAY, TEXT_PRIMARY, TEXT_SECONDARY, ACCENT } from '@/lib/constants/theme'

interface StatCardProps {
  icon:        string
  label:       string
  value:       string
  delta?:      string
  deltaColor?: string
  sub?:        string
}

export function StatCard({ icon, label, value, delta, deltaColor: dc, sub }: StatCardProps) {
  return (
    <div style={{
      background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 14,
      padding: '16px 18px', boxShadow: SHADOW_SM, flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {label}
        </span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: FONT_DISPLAY, color: TEXT_PRIMARY, letterSpacing: '-0.02em', marginBottom: 4 }}>
        {value}
      </div>
      {delta && (
        <div style={{ fontSize: 12, fontWeight: 600, color: dc ?? ACCENT }}>
          {delta}
          {sub && <span style={{ color: '#9AAAB8', fontWeight: 400, marginLeft: 4 }}>{sub}</span>}
        </div>
      )}
    </div>
  )
}