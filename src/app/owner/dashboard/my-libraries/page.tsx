// src/app/(owner)/dashboard/my-libraries/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getOwnerLibraries } from '@/lib/actions/owner'
import MyLibrariesClient from '@/components/owner/MyLibrariesClient'

export default async function MyLibrariesPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraries = await getOwnerLibraries()

  // Aggregate stats
  const totalRev     = libraries.reduce((s, l) => s + l.month_revenue, 0)
  const totalMembers = libraries.reduce((s, l) => s + l.member_count, 0)
  const avgOcc       = libraries.length
    ? Math.round(libraries.reduce((s, l) => s + (l.total_seats ? l.active_seats / l.total_seats : 0), 0) / libraries.length * 100)
    : 0

  return (
    <MyLibrariesClient
      libraries={libraries}
      totalRev={totalRev}
      totalMembers={totalMembers}
      avgOcc={avgOcc}
    />
  )
}