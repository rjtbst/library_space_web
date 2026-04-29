// src/app/(owner)/dashboard/slot-config/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSlotConfigs, getOwnerLibraries } from '@/lib/actions/owner'
import SlotConfigClient from '@/components/owner/SlotConfigClient'

export default async function SlotConfigPage({
  searchParams,
}: {
  searchParams: { lib?: string }
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraries = await getOwnerLibraries()
  const libraryId = searchParams.lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const slots = await getSlotConfigs(libraryId)
  const lib   = libraries.find(l => l.id === libraryId)

  return (
    <SlotConfigClient
      slots={slots}
      libraryId={libraryId}
      libraryName={lib?.name ?? ''}
      libraries={libraries}
    />
  )
}