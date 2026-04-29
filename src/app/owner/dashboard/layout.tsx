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
      {/* Main content — offset for sidebar */}
      <div style={{
        flex: 1, marginLeft: 240,
        minHeight: '100vh', overflowX: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}