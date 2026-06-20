// src/app/(staff)/staff/layout.tsx
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'

import StaffSidebar from '@/components/staff/Staffsidebar'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
 
  const { supabase, user, profile} = await requireRole('staff')

  if(!profile.onboarded) redirect('/onboarding/role')

  const {data : staffRow} = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

    //staffRow?.role is 'staff' | 'senior_staff' | null
    // null means not yet assigned to a library - nav still renders, role-gating is fine

    const staffRole = staffRow?.role ?? null
    return(
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