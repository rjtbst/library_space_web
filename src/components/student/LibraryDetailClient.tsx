// src/components/student/LibraryDetailClient.tsx
/**
 * Server-component wrapper around LibraryDetail.
 *
 * The library-detail page (app/(student)/library/[id]/page.tsx) fetches
 * `library`, `books`, and `profile` and passes them here.
 *
 * SLOT-ONLY ARCHITECTURE: `library` (a LibraryCard from getLibraryDetail)
 * already includes `slots` (all slot_configs for this library, active +
 * inactive) and `status` (open/closed + today's hours, derived from those
 * slots via lib/booking/libraryStatus.ts) — both computed once in
 * getLibraryDetail/buildCard, so this wrapper just passes them through. No
 * separate fetch is needed for slots or open/closed status.
 *
 * This component fetches the one piece of data that depends on the
 * signed-in user — the active subscription for this library — then renders
 * the 'use client' LibraryDetail with the exact shape it expects.
 *
 * NOTE: `books` and `profile` are accepted for forward-compatibility with
 * the page contract but are not rendered by the current LibraryDetail
 * component (which covers the hero/info/slots/plans/CTA sections only —
 * no Books tab). If/when a Books tab is added to LibraryDetail, wire
 * `books` through as a prop at that point.
 */

import LibraryDetail from './LibraryDetail'
import {
  getActiveSubscriptionForLibrary,
  type LibraryCard,
  type LibraryBook,
  type StudentProfile,
} from '@/lib/actions/student'

export default async function LibraryDetailClient({
  library,
  books: _books,
  profile: _profile,
}: {
  library: LibraryCard
  books:   LibraryBook[]
  profile: StudentProfile | null
}) {
  const activeSub = await getActiveSubscriptionForLibrary(library.id)

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
        amenities:     library.amenities,
        images:        library.image_urls,
      }}
      ownerSlots={library.slots}
      plans={library.plans}
      freeSeats={library.available_seats}
      status={library.status}
      activeSub={activeSub}
    />
  )
}