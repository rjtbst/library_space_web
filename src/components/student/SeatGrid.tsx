// components/student/SeatGrid.tsx
'use client'

/**
 * 2D seat grid component.
 *
 * Renders library seats in a grid layout by row (A, B, C…) and column.
 * Each seat shows availability status with color coding.
 * Selected seat pulses with a blue ring.
 * Scrollable horizontally for wide grids (>10 columns).
 *
 * Also shows a visual "library front" orientation marker.
 */

import { cn } from '@/lib/utils'
import type { SeatAvailability } from '@/lib/actions/student'

interface Props {
  seats:        SeatAvailability[]
  selectedId:   string | null
  onSelect:     (id: string) => void
  loading?:     boolean
}

const STATUS_STYLE = {
  available: 'bg-[#D1FAE5] text-[#0D7C54] hover:bg-[#A7F3D0] hover:scale-110 cursor-pointer border border-[#6EE7B7]',
  taken:     'bg-[#FEE2E2] text-[#C5282C] cursor-not-allowed opacity-70 border border-[#FCA5A5]',
  selected:  'bg-[#1246FF] text-white shadow-[0_0_0_3px_rgba(18,70,255,0.3)] scale-110 border border-[#1246FF] cursor-pointer',
}

function SeatSkeleton() {
  return (
    <div className="space-y-3">
      {[4, 5, 4].map((count, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-[#F4F7FB] flex-shrink-0" />
          <div className="flex gap-1.5">
            {Array.from({ length: count }).map((_, j) => (
              <div key={j} className="w-9 h-9 rounded-lg bg-[#F4F7FB] animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SeatGrid({ seats, selectedId, onSelect, loading }: Props) {
  if (loading) return <SeatSkeleton />

  if (!seats.length) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="text-3xl mb-2">🪑</div>
        <p className="text-[13px] text-[#9AACBE]">No seats available for this time slot</p>
      </div>
    )
  }

  // Group by row label
  const rows = [...new Set(seats.map((s) => s.row_label))].sort()
  const colCount = Math.max(...seats.map((s) => s.column_number))

  const availCount = seats.filter((s) => s.is_available).length
  const takenCount = seats.length - availCount

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {[
            { color: 'bg-[#D1FAE5] border border-[#6EE7B7]', label: `Free (${availCount})` },
            { color: 'bg-[#FEE2E2] border border-[#FCA5A5]', label: `Taken (${takenCount})` },
            { color: 'bg-[#1246FF]', label: 'Selected' },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-[11px] text-[#6E7F94]">
              <span className={cn('w-3 h-3 rounded', color)} />
              {label}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-[#9AACBE]">{seats.length} total seats</span>
      </div>

      {/* Front of library indicator */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-[#E4EAF2]" />
        <span className="text-[10px] font-semibold text-[#9AACBE] uppercase tracking-widest px-2 flex items-center gap-1">
          🖥️ Front / Board
        </span>
        <div className="flex-1 h-px bg-[#E4EAF2]" />
      </div>

      {/* Seat grid — horizontal scroll for wide layouts */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="min-w-max space-y-1.5">
          {rows.map((row) => {
            const rowSeats = seats
              .filter((s) => s.row_label === row)
              .sort((a, b) => a.column_number - b.column_number)

            // Build a map for O(1) lookup by column
            const byCol = new Map(rowSeats.map((s) => [s.column_number, s]))

            return (
              <div key={row} className="flex items-center gap-2">
                {/* Row label */}
                <span className="w-5 text-[11px] font-bold text-[#9AACBE] text-center flex-shrink-0 select-none">
                  {row}
                </span>

                {/* Seats in this row */}
                <div className="flex gap-1.5">
                  {Array.from({ length: colCount }, (_, i) => i + 1).map((col) => {
                    const seat = byCol.get(col)

                    if (!seat) {
                      // Gap (aisle) — render empty space
                      return (
                        <div
                          key={col}
                          className="w-9 h-9 flex-shrink-0"
                          title={`${row}${col} — aisle`}
                        />
                      )
                    }

                    const isSelected = seat.id === selectedId
                    const statusKey  = !seat.is_available ? 'taken' : isSelected ? 'selected' : 'available'

                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={!seat.is_available}
                        onClick={() => seat.is_available && onSelect(isSelected ? '' : seat.id)}
                        title={`Seat ${seat.label} — ${seat.is_available ? 'Available' : 'Taken'}`}
                        className={cn(
                          'w-9 h-9 rounded-lg text-[11px] font-bold flex-shrink-0',
                          'transition-all duration-150 flex items-center justify-center',
                          STATUS_STYLE[statusKey],
                        )}
                      >
                        {col}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Column numbers footer */}
      <div className="flex items-center gap-2 pl-7 overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-1.5 min-w-max">
          {Array.from({ length: colCount }, (_, i) => i + 1).map((col) => (
            <span key={col} className="w-9 text-center text-[9px] text-[#C4CDD8] font-medium flex-shrink-0">
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}