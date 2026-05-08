// src/app/(owner)/dashboard/bookings/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getTodayBookings } from '@/lib/actions/owner'
import BookingsClient from '@/components/owner/BookingsClient'

export const dynamic = 'force-dynamic'  // already have this ✓

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ lib?: string }>
}) {
  const { lib } = await searchParams

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const [bookings, libRow] = await Promise.all([
    getTodayBookings(libraryId),
    supabase.from('libraries').select('name').eq('id', libraryId).maybeSingle(),
  ])

  return (
    <BookingsClient
      bookings={bookings}
      libraryName={libRow.data?.name ?? ''}
      libraryId={libraryId}
    />
  )
}