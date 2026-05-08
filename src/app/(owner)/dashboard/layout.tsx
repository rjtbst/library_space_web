// src/app/(owner)/dashboard/layout.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getFirstLibraryId } from '@/lib/actions/owner'
import OwnerSidebar from '@/components/owner/OwnerSidebar'

export const metadata = { title: 'Owner Dashboard — LibrarySpace' }

export default async function OwnerDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role !== 'owner') redirect('/student/home')

  const firstLibraryId = await getFirstLibraryId()

  return (
    <div style={{
      display: 'flex', minHeight: '100vh',
      background: '#F4F7FB', fontFamily: 'DM Sans, sans-serif',
    }}>
      <OwnerSidebar
        ownerName={profile?.full_name ?? 'Owner'}
        firstLibraryId={firstLibraryId}
      />
      {/* Main content */}
      <div style={{
        flex: 1,
        // Desktop: offset for fixed sidebar. Mobile: no left margin, top padding for top bar
        marginLeft: 'clamp(0px, 240px, 240px)',
        paddingTop: 0,
        minHeight: '100vh',
        overflowX: 'hidden',
      }}
        className="dashboard-main"
      >
        {children}
      </div>

      {/* Responsive overrides via a style tag */}
      <style>{`
        @media (max-width: 767px) {
          .dashboard-main {
            margin-left: 0 !important;
            padding-top: 56px !important;
          }
        }
      `}</style>
    </div>
  )
}