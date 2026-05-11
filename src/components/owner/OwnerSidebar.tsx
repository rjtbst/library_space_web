'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { signOut } from '@/lib/actions/auth'

const ACCENT       = '#0D7C54'
const ACCENT_LIGHT = '#D1FAE5'

const NAV = [
  { href: '/dashboard',              icon: '📊', label: 'Dashboard'       },
  { href: '/dashboard/my-libraries', icon: '🏛️', label: 'My Libraries'    },
  { href: '/dashboard/bookings',     icon: '📋', label: "Today's Bookings" },
  { href: '/dashboard/seat-manager', icon: '💺', label: 'Seat Manager'    },
  { href: '/dashboard/slot-config',  icon: '⏰', label: 'Slot Config'     },
  { href: '/dashboard/plan-builder', icon: '🎯', label: 'Plan Builder'    },
  { href: '/dashboard/staff',        icon: '👥', label: 'Staff'           },
]

export default function OwnerSidebar({
  ownerName,
  firstLibraryId,
}: {
  ownerName: string
  firstLibraryId: string | null
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close drawer on route change (mobile)
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const SidebarContent = () => (
    <aside style={{
      width: 240,
      height: '100%',
      background: '#FDFCF9',
      borderRight: isMobile ? 'none' : '1px solid #E2DDD4',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: isMobile ? 'none' : '2px 0 12px rgba(10,13,18,.05)',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid #E2DDD4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        {/* Close button — mobile only */}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: '#6B7689', padding: 4, lineHeight: 1,
            }}
            aria-label="Close menu"
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#9AAAB8',
          textTransform: 'uppercase', letterSpacing: '.08em',
          padding: '8px 10px 6px',
        }}>
          Menu
        </div>
        {NAV.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href))
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
      <div style={{ padding: '12px 16px', borderTop: '1px solid #E2DDD4' }}>
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

  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: 56,
          background: '#FDFCF9', borderBottom: '1px solid #E2DDD4',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', zIndex: 100,
          boxShadow: '0 2px 8px rgba(10,13,18,.06)',
        }}>
          {/* Hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 5,
              padding: 6, borderRadius: 8,
            }}
            aria-label="Open menu"
          >
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 22, height: 2, background: '#3A4A5C', borderRadius: 2,
              }} />
            ))}
          </button>

          {/* Logo center */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: ACCENT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>
              📚
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: '#0A0D12', letterSpacing: '-0.02em' }}>
              LibrarySpace
            </span>
          </div>

          {/* Avatar */}
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: '#fff', fontWeight: 700,
          }}>
            {ownerName.charAt(0).toUpperCase()}
          </div>
        </div>

        {/* Overlay */}
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(10,13,18,.4)',
              zIndex: 200, backdropFilter: 'blur(2px)',
            }}
          />
        )}

        {/* Drawer */}
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 260, zIndex: 300,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: mobileOpen ? '4px 0 24px rgba(10,13,18,.15)' : 'none',
        }}>
          <SidebarContent />
        </div>
      </>
    )
  }

  // Desktop — fixed sidebar (original behaviour)
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: 240, zIndex: 50,
    }}>
      <SidebarContent />
    </div>
  )
}