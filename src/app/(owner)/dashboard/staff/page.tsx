// src/app/(owner)/dashboard/staff/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getOwnerLibraries } from '@/lib/actions/owner'
import { getOwnerStaff, getPendingRequests } from '@/lib/actions/owner-staff'
import StaffManagementClient from '@/components/owner/Staffmanagementclient'

export const dynamic = 'force-dynamic'

export default async function StaffManagementPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [libraries, staffMembers, pendingRequests] = await Promise.all([
    getOwnerLibraries(),
    getOwnerStaff(),
    getPendingRequests(),
  ])

  if (!libraries.length) redirect('/onboarding/add-library')

  return (
    <StaffManagementClient
      libraries={libraries}
      staffMembers={staffMembers}
      pendingRequests={pendingRequests}
    />
  )
}