'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/lib/actions/auth'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'

const NAV = [
  { href: '/owner/dashboard',              icon: '📊', label: 'Dashboard'       },
  { href: '/owner/dashboard/my-libraries', icon: '🏛️', label: 'My Libraries'    },
  { href: '/owner/dashboard/bookings',     icon: '📋', label: "Today's Bookings" },
  { href: '/owner/dashboard/seat-manager', icon: '💺', label: 'Seat Manager'    },
  { href: '/owner/dashboard/slot-config',  icon: '⏰', label: 'Slot Config'     },
  { href: '/owner/dashboard/plan-builder', icon: '🎯', label: 'Plan Builder'    },
]

export default function OwnerSidebar({
  ownerName,
  firstLibraryId,
}: {
  ownerName: string
  firstLibraryId: string | null
}) {
  const pathname = usePathname()

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: 240,
      background: '#FDFCF9', borderRight: '1px solid #E2DDD4',
      display: 'flex', flexDirection: 'column', zIndex: 50,
      boxShadow: '2px 0 12px rgba(10,13,18,.05)',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid #E2DDD4',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, boxShadow: '0 2px 8px rgba(13,124,84,.3)',
          }}>
            📚
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12', letterSpacing: '-0.02em' }}>
              LibrarySpace
            </div>
            <div style={{ fontSize: 10, color: '#9AAAB8', fontWeight: 500 }}>Owner Portal</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9AAAB8', textTransform: 'uppercase', letterSpacing: '.08em', padding: '8px 10px 6px' }}>
          Menu
        </div>
        {NAV.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/owner/dashboard' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 9, marginBottom: 2,
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? ACCENT : '#3A4A5C',
                background: active ? ACCENT_LIGHT : 'transparent',
                textDecoration: 'none',
                transition: 'all .12s',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
              {item.label}
              {active && (
                <div style={{
                  marginLeft: 'auto', width: 6, height: 6,
                  borderRadius: '50%', background: ACCENT,
                }} />
              )}
            </Link>
          )
        })}

        {/* Quick-jump: Add library */}
        <div style={{ height: 1, background: '#E2DDD4', margin: '10px 4px' }} />
        <Link
          href="/onboarding/add-library"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 9,
            fontSize: 13, fontWeight: 600, color: ACCENT,
            border: `1.5px dashed ${ACCENT}`,
            textDecoration: 'none', transition: 'all .12s',
            background: 'transparent',
          }}
        >
          <span style={{ fontSize: 16 }}>+</span>
          Add Library
        </Link>
      </nav>

      {/* User footer */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #E2DDD4',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: '#fff', fontWeight: 700, flexShrink: 0,
          }}>
            {ownerName.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0A0D12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ownerName}
            </div>
            <div style={{ fontSize: 10, color: '#9AAAB8' }}>Library Owner</div>
          </div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8,
              fontSize: 12, fontWeight: 600, color: '#6B7689',
              border: '1.5px solid #E2DDD4', background: 'transparent',
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
              transition: 'all .12s',
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}