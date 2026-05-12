/**
 * Library selector pills — used in Seat Manager, Slot Config, Dashboard.
 * Triggers nav progress bar on click.
 *
 * Usage:
 *   <LibraryPicker
 *     libraries={libraries}
 *     currentId={libraryId}
 *     buildHref={(id) => `/dashboard/seat-manager?lib=${id}`}
 *   />
 */
'use client'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import type { OwnerLibrary } from '@/lib/actions/owner'
import { ACCENT, ACCENT_LIGHT, BORDER, BG_CARD, TEXT_SECONDARY, FONT_BODY } from '@/lib/constants/theme'

interface LibraryPickerProps {
  libraries:  OwnerLibrary[]
  currentId:  string
  buildHref:  (id: string) => string
  colorScheme?: 'green' | 'blue'   // default: green (accent)
}

export function LibraryPicker({
  libraries, currentId, buildHref, colorScheme = 'green',
}: LibraryPickerProps) {
  const router = useRouter()

  const activeColor = colorScheme === 'blue' ? '#1E5CFF' : ACCENT
  const activeBg    = colorScheme === 'blue' ? '#E8EFFE' : ACCENT_LIGHT

  const handleClick = useCallback((id: string) => {
    ;(window as any).__startNavProgress?.()
    router.push(buildHref(id))
  }, [router, buildHref])

  if (libraries.length <= 1) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {libraries.map(lib => {
        const active = lib.id === currentId
        return (
          <button
            key={lib.id}
            onClick={() => handleClick(lib.id)}
            style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1.5px solid ${active ? activeColor : BORDER}`,
              background: active ? activeBg : BG_CARD,
              color: active ? activeColor : TEXT_SECONDARY,
              cursor: 'pointer', fontFamily: FONT_BODY,
              transition: 'all .12s',
            }}
          >
            {lib.name}
          </button>
        )
      })}
    </div>
  )
}