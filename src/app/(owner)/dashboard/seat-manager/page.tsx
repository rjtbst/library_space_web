// src/app/(owner)/dashboard/seat-manager/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSeatLayout, getOwnerLibraries } from '@/lib/actions/owner'
import SeatManagerClient from '@/components/owner/seatManagerClient'

export const dynamic = 'force-dynamic'

export default async function SeatManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ lib?: string }>
}) {
  const { lib } = await searchParams  // ← was missing await: caused lib = "[object Promise]"

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const [seats, libraries] = await Promise.all([
    getSeatLayout(libraryId),
    getOwnerLibraries(),
  ])

  const libMeta = libraries.find(l => l.id === libraryId)

  return (
    <SeatManagerClient
      seats={seats}
      libraryId={libraryId}
      libraryName={libMeta?.name ?? ''}
      libraries={libraries}
    />
  )
}