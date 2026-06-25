// src/app/(staff)/staff/layout.tsx
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { getStaffLibrary } from '@/lib/actions/staff'

import StaffSidebar from '@/components/staff/Staffsidebar'
import { StaffNavProgressBar } from '@/components/staff/NavProgressBar'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {

  const { profile } = await requireRole('staff')

  if (!profile.onboarded) redirect('/onboarding/role')

  // getStaffLibrary is cache()-wrapped and already does this exact lookup
  // (role + library) — reusing it here means a page further down the tree
  // that also calls getStaffLibrary() hits React's per-request cache
  // instead of firing a second, identical query against `staff`.
  const staffLib = await getStaffLibrary()

  // staffLib is null both when the user has no library assignment yet AND
  // on any lookup error — nav still renders either way; role-gating for
  // specific pages (e.g. senior_staff-only seat manager) happens at the
  // page level, not here.
  const staffRole = staffLib?.role ?? null

  return (
    <div style={{
      minHeight:   '100vh',
      background:  '#F4F7FB',
      fontFamily:  'DM Sans, sans-serif',
      paddingBottom: 72,
    }}>
      {/* StaffNavProgressBar needs Suspense because it reads useSearchParams */}
      <Suspense fallback={null}>
        <StaffNavProgressBar />
      </Suspense>
      <main>{children}</main>
      <StaffSidebar role={staffRole} staffName={profile.full_name} />
    </div>
  )

}