// src/app/(owner)/dashboard/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  getFirstLibraryId, getDashboardStats, getMonthlyRevenue,
  getTodayBookings, getSlotHeatmap, getOwnerLibraries,
} from '@/lib/actions/owner'
import DashboardClient from '@/components/owner/DashboardClient'

export default async function OwnerDashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const libraryId = await getFirstLibraryId()
  if (!libraryId) redirect('/onboarding/add-library')

  const [stats, revenue, bookings, heatmap, libraries] = await Promise.all([
    getDashboardStats(libraryId),
    getMonthlyRevenue(libraryId),
    getTodayBookings(libraryId),
    getSlotHeatmap(libraryId),
    getOwnerLibraries(),
  ])

  const { data: lib } = await supabase
    .from('libraries').select('name').eq('id', libraryId).maybeSingle()

  return (
    <>
    <h1> hello owner</h1>
    <DashboardClient
      libraryName={lib?.name ?? 'Your Library'}
      libraryId={libraryId}
      libraries={libraries}
      stats={stats}
      revenue={revenue}
      bookings={bookings}
      heatmap={heatmap}
      />
      </>
  )
}