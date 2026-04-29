import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSeatLayout, getOwnerLibraries } from '@/lib/actions/owner'
import SeatManagerClient from '@/components/owner/seatManagerClient'


export default async function SeatManagerPage({
  searchParams,
}: {
  searchParams: { lib?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraries  = await getOwnerLibraries()
  const libraryId  = searchParams.lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const seats = await getSeatLayout(libraryId)
  const lib   = libraries.find(l => l.id === libraryId)

  return (
    <SeatManagerClient
      seats={seats}
      libraryId={libraryId}
      libraryName={lib?.name ?? ''}
      libraries={libraries}
    />
  )
}