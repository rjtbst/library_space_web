// src/app/(owner)/dashboard/staff/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
// ← getOwnerLibraries REMOVED
import { getOwnerStaff, getPendingRequests } from '@/lib/actions/owner-staff'
import StaffManagementClient from '@/components/owner/Staffmanagementclient'

export const dynamic = 'force-dynamic'

export default async function StaffManagementPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [staffMembers, pendingRequests] = await Promise.all([
    getOwnerStaff(),
    getPendingRequests(),
  ])

  // libraries check moved to layout — if owner has no libraries they'd never reach this page

  return (
    <StaffManagementClient
      staffMembers={staffMembers}
      pendingRequests={pendingRequests}
      // ← libraries prop removed — component reads from useOwner()
    />
  )
}