// src/app/(staff)/staff/layout.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import StaffSidebar from '@/components/staff/Staffsidebar'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Verify the user is actually a staff member
  const { data: profile } = await supabase
    .from('users')
    .select('role, onboarded')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/auth/login')
  if (profile.role !== 'staff') redirect('/dashboard')
  if (!profile.onboarded) redirect('/onboarding/role')

  // Fetch staff role (staff vs senior_staff) from the staff table
  const { data: staffRow } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  // staffRow?.role is 'staff' | 'senior_staff' | null
  // null means not yet assigned to a library — nav still renders, role-gating is fine
  const staffRole = staffRow?.role ?? null

  return (
    <div style={{
      minHeight:   '100vh',
      background:  '#F4F7FB',
      fontFamily:  'DM Sans, sans-serif',
      paddingBottom: 72,
    }}>
      <main>{children}</main>
      {/* <StaffNav role={staffRole} /> */}
     <StaffSidebar role={staffRole} />
    </div>
  )
}