// components/student/ExploreClient.tsx
'use client'

import {
  useState, useCallback, useTransition, useRef, useEffect, lazy, Suspense,
} from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { LibraryCard } from '@/lib/actions/student'
import LibraryCardTile from './LibraryCard'
import {
  Search, SlidersHorizontal, X, MapPin, Clock,
  ChevronLeft, ChevronRight, Loader2, Navigation,
  AlertCircle, Map, List,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGeolocation } from '@/hooks/useGeolocation'

// Lazy-load MapView so Google Maps SDK only loads when the tab is opened
const MapView = lazy(() => import('./MapView'))

interface Props {
  initialLibraries: LibraryCard[]
  total:            number
  cities:           string[]
  allAmenities:     string[]
  profileCity:      string | null
  initialFilters: {
    q:         string
    city:      string
    open_now:  boolean
    amenities: string[]
    lat?:      number
    lng?:      number
  }
  page: number
}

const LIMIT = 12

export default function ExploreClient({
  initialLibraries, total, cities, allAmenities,
  profileCity, initialFilters, page,
}: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { geo, request: requestGeo } = useGeolocation()

  const [viewMode, setViewMode]     = useState<'list' | 'map'>('list')
  const [q,            setQ]            = useState(initialFilters.q)
  const [city,         setCity]         = useState(initialFilters.city)
  const [openNow,      setOpenNow]      = useState(initialFilters.open_now)
  const [selAmenities, setSelAmenities] = useState<string[]>(initialFilters.amenities)
  const [showFilters,  setShowFilters]  = useState(false)
  const [locEnabled,   setLocEnabled]   = useState(
    initialFilters.lat != null && initialFilters.lng != null,
  )

  const totalPages = Math.ceil(total / LIMIT)

  const navigate = useCallback((params: Record<string, string>) => {
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v) })
    startTransition(() => router.push(`${pathname}?${sp.toString()}`))
  }, [router, pathname])

  const buildAndNavigate = useCallback((overrides: {
    q?: string; city?: string; open_now?: boolean; amenities?: string[]
    page?: number; lat?: number | null; lng?: number | null
  } = {}) => {
    const curLat = locEnabled && geo.status === 'granted' ? geo.lat : null
    const curLng = locEnabled && geo.status === 'granted' ? geo.lng : null
    navigate({
      q:        overrides.q         !== undefined ? overrides.q         : q,
      city:     overrides.city      !== undefined ? overrides.city      : city,
      open_now: (overrides.open_now !== undefined ? overrides.open_now  : openNow) ? '1' : '',
      amenities: (overrides.amenities !== undefined ? overrides.amenities : selAmenities).join(','),
      page:     String(overrides.page ?? 1),
      lat:      String(overrides.lat  !== undefined ? (overrides.lat  ?? '') : (curLat ?? '')),
      lng:      String(overrides.lng  !== undefined ? (overrides.lng  ?? '') : (curLng ?? '')),
    })
  }, [q, city, openNow, selAmenities, locEnabled, geo, navigate])

  const handleSearch = useCallback((val: string) => {
    setQ(val)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => buildAndNavigate({ q: val }), 420)
  }, [buildAndNavigate])

  function handleLocationToggle() {
    if (locEnabled) { setLocEnabled(false); buildAndNavigate({ lat: null, lng: null }); return }
    requestGeo()
  }

  useEffect(() => {
    if (geo.status === 'granted' && !locEnabled) {
      setLocEnabled(true)
      buildAndNavigate({ lat: geo.lat, lng: geo.lng })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status])

  const toggleAmenity = (a: string) => {
    const next = selAmenities.includes(a) ? selAmenities.filter((x) => x !== a) : [...selAmenities, a]
    setSelAmenities(next)
    buildAndNavigate({ amenities: next })
  }

  const clearAll = () => {
    setQ(''); setCity(''); setOpenNow(false); setSelAmenities([])
    setLocEnabled(false); navigate({})
  }

  const hasFilters = !!q || !!city || openNow || selAmenities.length > 0
  const userLat    = geo.status === 'granted' && locEnabled ? geo.lat : null
  const userLng    = geo.status === 'granted' && locEnabled ? geo.lng : null

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 58px)' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-[#E4EAF2] px-4 md:px-6 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-bold text-[#0D1117]">Find a Library</h1>
            <p className="text-[11px] text-[#9AACBE]">
              {locEnabled && geo.status === 'granted' ? 'Sorted by distance · ' : ''}
              {total} spot{total !== 1 ? 's' : ''}
            </p>
          </div>
          {/* List / Map toggle */}
          <div className="flex items-center bg-[#F4F7FB] rounded-lg p-0.5 border border-[#E4EAF2]">
            {(['list', 'map'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-all capitalize',
                  viewMode === m ? 'bg-white text-[#0D1117] shadow-sm' : 'text-[#9AACBE] hover:text-[#6E7F94]',
                )}
              >
                {m === 'list' ? <List className="w-3.5 h-3.5" /> : <Map className="w-3.5 h-3.5" />}
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9AACBE] pointer-events-none" />
          <input
            type="text" value={q} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, city, area…"
            className="w-full h-10 pl-9 pr-9 bg-[#F4F7FB] border border-[#E4EAF2] rounded-xl text-[13px] text-[#0D1117] placeholder:text-[#9AACBE] focus:outline-none focus:border-[#1246FF] focus:bg-white transition-all"
          />
          {q && <button onClick={() => handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-[#9AACBE]" /></button>}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            onClick={handleLocationToggle}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all',
              locEnabled && geo.status === 'granted' ? 'bg-[#1246FF] border-[#1246FF] text-white'
              : geo.status === 'loading' ? 'bg-[#F4F7FB] border-[#E4EAF2] text-[#9AACBE]'
              : 'bg-white border-[#E4EAF2] text-[#6E7F94] hover:border-[#1246FF]',
            )}
          >
            {geo.status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
            {geo.status === 'granted' && locEnabled ? 'Near Me ✓' : 'Near Me'}
          </button>

          <button
            onClick={() => { setOpenNow((v) => !v); buildAndNavigate({ open_now: !openNow }) }}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all',
              openNow ? 'bg-[#D1FAE5] border-[#0D7C54] text-[#0D7C54]' : 'bg-white border-[#E4EAF2] text-[#6E7F94] hover:border-[#0D7C54]',
            )}
          >
            <Clock className="w-3 h-3" />Open Now
          </button>

          {selAmenities.map((a) => (
            <button key={a} onClick={() => toggleAmenity(a)}
              className="flex-shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#1246FF] text-white border border-[#1246FF] text-[11px] font-medium">
              {a}<X className="w-2.5 h-2.5" />
            </button>
          ))}

          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-medium transition-all',
              showFilters ? 'bg-[#E8EFFE] border-[#1246FF] text-[#1246FF]' : 'bg-white border-[#E4EAF2] text-[#6E7F94] hover:border-[#1246FF]',
            )}
          >
            <SlidersHorizontal className="w-3 h-3" />More
            {hasFilters && <span className="w-4 h-4 rounded-full bg-[#1246FF] text-white text-[9px] font-bold flex items-center justify-center">{[!!q,!!city,openNow,selAmenities.length>0].filter(Boolean).length}</span>}
          </button>

          {hasFilters && (
            <button onClick={clearAll} className="flex-shrink-0 h-7 px-2.5 rounded-full border border-[#E4EAF2] text-[11px] text-[#C5282C] hover:bg-[#FEE2E2] transition-all">
              Clear all
            </button>
          )}
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <div className="pt-2 border-t border-[#F4F7FB] space-y-3 animate-in slide-in-from-top-1 duration-150">
            <div>
              <p className="text-[10px] font-bold text-[#9AACBE] uppercase tracking-wider mb-1.5">City</p>
              <select value={city} onChange={(e) => { setCity(e.target.value); buildAndNavigate({ city: e.target.value }) }}
                className="w-full px-3 py-2 bg-[#F4F7FB] border border-[#E4EAF2] rounded-lg text-[13px] text-[#0D1117] focus:outline-none focus:border-[#1246FF] appearance-none cursor-pointer">
                <option value="">All Cities</option>
                {profileCity && <option value={profileCity}>{profileCity} (My City)</option>}
                {cities.filter((c) => c !== profileCity).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {allAmenities.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-[#9AACBE] uppercase tracking-wider mb-1.5">Amenities</p>
                <div className="flex flex-wrap gap-1.5">
                  {allAmenities.map((a) => (
                    <button key={a} onClick={() => toggleAmenity(a)}
                      className={cn('px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all',
                        selAmenities.includes(a) ? 'bg-[#1246FF] border-[#1246FF] text-white' : 'bg-white border-[#E4EAF2] text-[#6E7F94] hover:border-[#1246FF]')}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {geo.status === 'denied' && (
          <div className="flex items-start gap-2 bg-[#FEF3C7] rounded-xl px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-[#B45309] flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#92400E]">{geo.reason}</p>
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────── */}
      {viewMode === 'list' ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-4">
            {isPending ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-[#1246FF]" />
                <p className="text-[13px] text-[#9AACBE]">Finding libraries…</p>
              </div>
            ) : initialLibraries.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#F4F7FB] flex items-center justify-center mb-4"><Search className="w-6 h-6 text-[#C4CDD8]" /></div>
                <h3 className="text-[14px] font-semibold text-[#0D1117] mb-1">No libraries found</h3>
                <p className="text-[12px] text-[#9AACBE] max-w-xs">{hasFilters ? 'Try adjusting your filters.' : 'No libraries available.'}</p>
                {hasFilters && <button onClick={clearAll} className="mt-4 px-5 py-2.5 bg-[#1246FF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0E38CC] transition-colors">Clear Filters</button>}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {initialLibraries.map((lib) => <LibraryCardTile key={lib.id} library={lib} />)}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-8">
                    <button disabled={page<=1} onClick={() => buildAndNavigate({ page: page-1 })} className="w-9 h-9 rounded-xl border border-[#E4EAF2] bg-white flex items-center justify-center disabled:opacity-40 hover:border-[#1246FF] transition"><ChevronLeft className="w-4 h-4 text-[#6E7F94]" /></button>
                    <span className="text-[13px] text-[#6E7F94] min-w-[100px] text-center">Page {page} / {totalPages}</span>
                    <button disabled={page>=totalPages} onClick={() => buildAndNavigate({ page: page+1 })} className="w-9 h-9 rounded-xl border border-[#E4EAF2] bg-white flex items-center justify-center disabled:opacity-40 hover:border-[#1246FF] transition"><ChevronRight className="w-4 h-4 text-[#6E7F94]" /></button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="flex items-center justify-center h-full bg-[#F4F7FB]"><Loader2 className="w-6 h-6 animate-spin text-[#1246FF]" /></div>}>
            <MapView libraries={initialLibraries} userLat={userLat} userLng={userLng} />
          </Suspense>
        </div>
      )}
    </div>
  )
}