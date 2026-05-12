import { STATUS_STYLE } from '@/lib/constants/theme'

type StatusKey = keyof typeof STATUS_STYLE

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status as StatusKey] ?? STATUS_STYLE.confirmed
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

export function ColorBadge({
  children, bg, color,
}: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: bg, color,
    }}>
      {children}
    </span>
  )
}