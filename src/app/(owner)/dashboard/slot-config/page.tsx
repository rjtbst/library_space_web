// src/app/(owner)/dashboard/slot-config/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSlotConfigs, getOwnerLibraries } from '@/lib/actions/owner'
import SlotConfigClient from '@/components/owner/SlotConfigClient'

export const dynamic = 'force-dynamic'

export default async function SlotConfigPage({
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

  const [slots, libraries] = await Promise.all([
    getSlotConfigs(libraryId),
    getOwnerLibraries(),
  ])

  const libMeta = libraries.find(l => l.id === libraryId)

  return (
    <SlotConfigClient
      slots={slots}
      libraryId={libraryId}
      libraryName={libMeta?.name ?? ''}
      libraries={libraries}
    />
  )
}