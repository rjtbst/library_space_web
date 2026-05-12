import { TEXT_PRIMARY, TEXT_SECONDARY } from '@/lib/constants/theme'

interface EmptyStateProps {
  icon?:     string
  title:     string
  subtitle?: string
  action?:   React.ReactNode
}

export function EmptyState({ icon = '📭', title, subtitle, action }: EmptyStateProps) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#9AAAB8' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 16 }}>{subtitle}</div>}
      {action}
    </div>
  )
}