// src/components/student/LibraryDetailClient.tsx
/**
 * Server-component wrapper around LibraryDetail.
 *
 * The library-detail page (app/(student)/library/[id]/page.tsx) fetches
 * `library`, `books`, and `profile` and passes them here. This component
 * fetches the two pieces of data that depend on the library id and the
 * signed-in user — active slot configs and the user's active subscription
 * for this library — then renders the 'use client' LibraryDetail with the
 * exact shape it expects.
 *
 * NOTE: `books` and `profile` are accepted for forward-compatibility with
 * the page contract but are not rendered by the current LibraryDetail
 * component (which covers the hero/info/slots/plans/CTA sections only —
 * no Books tab). If/when a Books tab is added to LibraryDetail, wire
 * `books` through as a prop at that point.
 */

import LibraryDetail from './LibraryDetail'
import {
  getLibrarySlots,
  getActiveSubscriptionForLibrary,
  type LibraryCard,
  type LibraryBook,
  type StudentProfile,
} from '@/lib/actions/student'
import {isOpenNowIST} from '@/lib/utils/student'
import { formatTime12h } from '@/lib/booking/types'

export default async function LibraryDetailClient({
  library,
  books: _books,
  profile: _profile,
}: {
  library: LibraryCard
  books:   LibraryBook[]
  profile: StudentProfile | null
}) {
  const [ownerSlots, activeSub] = await Promise.all([
    getLibrarySlots(library.id),
    getActiveSubscriptionForLibrary(library.id),
  ])

  const isOpen    = isOpenNowIST(library.open_time, library.close_time)
  const openHours = `${formatTime12h(library.open_time.slice(0, 5))} – ${formatTime12h(library.close_time.slice(0, 5))}`

  return (
    <LibraryDetail
      library={{
        id:            library.id,
        name:          library.name,
        description:   library.description,
        city:          library.city,
        area:          library.area,
        address:       library.address,
        rating:        library.rating,
        total_reviews: library.total_reviews,
        base_price:    library.base_price,
        amenities:     library.amenities,
        images:        library.image_urls,
      }}
      ownerSlots={ownerSlots}
      plans={library.plans}
      freeSeats={library.available_seats}
      isOpen={isOpen}
      openHours={openHours}
      activeSub={activeSub}
    />
  )
}