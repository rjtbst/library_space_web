// src/app/(owner)/dashboard/plan-builder/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getOwnerPlans, getOwnerLibraries } from '@/lib/actions/owner'
import PlanBuilderClient from '@/components/owner/PlanBuilderClient'

export const dynamic = 'force-dynamic'

export default async function PlanBuilderPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [plans, libraries] = await Promise.all([
    getOwnerPlans(),
    getOwnerLibraries(),
  ])

  return <PlanBuilderClient plans={plans} libraries={libraries} />
}