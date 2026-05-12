// src/app/(owner)/dashboard/my-libraries/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getOwnerLibraries } from '@/lib/actions/owner'
import MyLibrariesClient from '@/components/owner/MyLibrariesClient'

export const dynamic = 'force-dynamic'

export default async function MyLibrariesPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Fresh fetch (force-dynamic ensures no caching)
  const libraries = await getOwnerLibraries()

  // ← No more totalRev/totalMembers/avgOcc here — computed via useMemo in client
  return <MyLibrariesClient libraries={libraries} />
}