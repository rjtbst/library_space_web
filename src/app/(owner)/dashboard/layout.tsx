import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId, getOwnerLibraries } from '@/lib/actions/owner'
import { OwnerProvider } from '@/contexts/OwnerContext'
import OwnerSidebar from '@/components/owner/OwnerSidebar'
import { NavProgressBar } from '@/components/owner/NavProgressBar'

export const metadata = { title: 'Owner Dashboard — LibrarySpace' }

export default async function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'owner') redirect('/student/home')

  // Fetch both in parallel — was sequential before
  const [firstLibraryId, libraries] = await Promise.all([
    getFirstLibraryId(),
    getOwnerLibraries(),
  ])

  return (
    <OwnerProvider
      ownerName={profile?.full_name ?? 'Owner'}
      firstLibraryId={firstLibraryId}
      libraries={libraries}
    >
      <div style={{ display: 'flex', minHeight: '100vh', background: '#F4F7FB', fontFamily: 'DM Sans, sans-serif' }}>
        {/* NavProgressBar needs Suspense because it reads useSearchParams */}
        <Suspense fallback={null}>
          <NavProgressBar />
        </Suspense>

        <OwnerSidebar />

        <div style={{ flex: 1, marginLeft: 'clamp(0px, 240px, 240px)', minHeight: '100vh', overflowX: 'hidden' }}
          className="dashboard-main"
        >
          {children}
        </div>

        <style>{`
          @media (max-width: 767px) {
            .dashboard-main { margin-left: 0 !important; padding-top: 56px !important; }
          }
          @keyframes shimmer { 0%,100% { opacity:1 } 50% { opacity:.45 } }
          @keyframes pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.6; transform:scale(1.2) } }
        `}</style>
      </div>
    </OwnerProvider>
  )
}