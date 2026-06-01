// src/app/(owner)/dashboard/slot-config/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSlotConfigs } from '@/lib/actions/owner'
// getOwnerLibraries REMOVED — SlotConfigClient reads libraries from useOwner() context
import SlotConfigClient from '@/components/owner/SlotConfigClient'

export const dynamic = 'force-dynamic'

export default async function SlotConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ lib?: string }>
}) {
  const { lib } = await searchParams

  const libraryId = lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  // Single client instantiation — both queries share it.
  // Previously this page created a second client inside the Promise.all via
  // a dynamic import, which was wasteful. Now it's one client, two parallel queries.
  const supabase = await createServerSupabaseClient()
  const [slots, libRow] = await Promise.all([
    getSlotConfigs(libraryId),
    supabase.from('libraries').select('name').eq('id', libraryId).maybeSingle(),
  ])

  return (
    <SlotConfigClient
      slots={slots}
      libraryId={libraryId}
      libraryName={libRow.data?.name ?? ''}
    />
  )
}