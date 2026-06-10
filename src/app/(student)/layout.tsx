// app/(student)/layout.tsx
import { redirect } from 'next/navigation'
import { getSupabaseUser } from '@/lib/supabase/server'
import StudentShell from '@/components/student/StudentShell'

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = await getSupabaseUser()
  if (!user) redirect('/auth/login?next=/explore')
  return <StudentShell>{children}</StudentShell>
}