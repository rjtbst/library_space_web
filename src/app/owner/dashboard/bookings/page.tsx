import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getTodayBookings } from '@/lib/actions/owner'
import BookingsClient from '@/components/owner/BookingsClient'

export default async function BookingsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const bookings = await getTodayBookings(libraryId)

  const { data: lib } = await supabase
    .from('libraries').select('name').eq('id', libraryId).maybeSingle()

  return <BookingsClient bookings={bookings} libraryName={lib?.name ?? ''} libraryId={libraryId} />
}