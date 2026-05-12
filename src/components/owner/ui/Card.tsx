import { SHADOW_SM, BG_CARD, BORDER } from '@/lib/constants/theme'
import { CSSProperties, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  style?: CSSProperties
  className?: string
  padding?: string | number
  hoverable?: boolean
}

export function Card({
  children,
  style,
  className,
  padding = '18px 20px',
  hoverable,
  ...props
}: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding,
        boxShadow: SHADOW_SM,
        transition: hoverable ? 'box-shadow .15s' : undefined,
        ...style,
      }}
      onMouseEnter={
        hoverable
          ? e =>
              (e.currentTarget.style.boxShadow =
                '0 6px 24px rgba(10,13,18,.10)')
          : undefined
      }
      onMouseLeave={
        hoverable
          ? e => (e.currentTarget.style.boxShadow = SHADOW_SM)
          : undefined
      }
      {...props}
    >
      {children}
    </div>
  )
}