// app/(student)/explore/page.tsx
import { Suspense } from 'react'
import { exploreLibraries, getAllAmenities, getStudentProfile } from '@/lib/actions/student'
import ExploreClient from '@/components/student/ExploreClient'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: {
    q?:        string
    city?:     string
    area?:     string
    open_now?: string
    amenities?: string
    page?:     string
    lat?:      string
    lng?:      string
  }
}

export default async function ExplorePage({ searchParams }: Props) {
  const page      = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const amenities = searchParams.amenities
    ? searchParams.amenities.split(',').filter(Boolean)
    : []
  const lat = searchParams.lat ? parseFloat(searchParams.lat) : undefined
  const lng = searchParams.lng ? parseFloat(searchParams.lng) : undefined

  const [{ libraries, total, cities }, allAmenities, profile] = await Promise.all([
    exploreLibraries({
      lat,
      lng,
      search:   searchParams.q,
      city:     searchParams.city,
      area:     searchParams.area,
      open_now: searchParams.open_now === '1',
      amenities,
      page,
      limit: 12,
    }),
    getAllAmenities(),
    getStudentProfile(),
  ])

  return (
    <ExploreClient
      initialLibraries={libraries}
      total={total}
      cities={cities}
      allAmenities={allAmenities}
      profileCity={profile?.city ?? null}
      initialFilters={{
        q:         searchParams.q      ?? '',
        city:      searchParams.city   ?? '',
        open_now:  searchParams.open_now === '1',
        amenities,
        lat,
        lng,
      }}
      page={page}
    />
  )
}