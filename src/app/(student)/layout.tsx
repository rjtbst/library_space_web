// app/(student)/layout.tsx
import { redirect } from 'next/navigation'
import StudentShell from '@/components/student/StudentShell'
import { requireRole } from '@/lib/auth/guards'

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode
}) {
 await requireRole('student')
  return <StudentShell>{children}</StudentShell>
}