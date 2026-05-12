// src/app/(owner)/dashboard/seat-manager/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSeatLayout } from '@/lib/actions/owner'
// ← getOwnerLibraries REMOVED
import SeatManagerClient from '@/components/owner/seatManagerClient'

export const dynamic = 'force-dynamic'

export default async function SeatManagerPage({ searchParams }: { searchParams: Promise<{ lib?: string }> }) {
  const { lib } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const [seats, libRow] = await Promise.all([
    getSeatLayout(libraryId),
    supabase.from('libraries').select('name').eq('id', libraryId).maybeSingle(),
  ])

  return (
    <SeatManagerClient
      seats={seats}
      libraryId={libraryId}
      libraryName={libRow.data?.name ?? ''}
      // ← libraries removed — component reads from useOwner()
    />
  )
}