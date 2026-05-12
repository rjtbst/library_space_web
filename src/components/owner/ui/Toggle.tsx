'use client'
import { ACCENT } from '@/lib/constants/theme'

interface ToggleProps {
  on:        boolean
  onChange:  (v: boolean) => void
  disabled?: boolean
}

export function Toggle({ on, onChange, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
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