// src/app/(owner)/dashboard/slot-config/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getSlotConfigs, getOwnerLibraries } from '@/lib/actions/owner'
import SlotConfigClient from '@/components/owner/SlotConfigClient'

export const dynamic = 'force-dynamic'

export default async function SlotConfigPage({ searchParams }: { searchParams: Promise<{ lib?: string }> }) {
  const { lib } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = lib ?? await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  // ← ONE query instead of two (getOwnerLibraries removed — lives in context)
  const [slots, libRow] = await Promise.all([
    getSlotConfigs(libraryId),
    // Get just this library's name efficiently
    (async () => {
      const { createServerSupabaseClient: sc } = await import('@/lib/supabase/server')
      const db = await sc()
      return db.from('libraries').select('name').eq('id', libraryId).maybeSingle()
    })(),
  ])

  return (
    <SlotConfigClient
      slots={slots}
      libraryId={libraryId}
      libraryName={libRow.data?.name ?? ''}
      // ← libraries prop removed — component reads from useOwner()
    />
  )
}