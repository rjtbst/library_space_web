// src/app/(owner)/dashboard/plan-builder/page.tsx
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getOwnerPlans } from '@/lib/actions/owner'  // ← getOwnerLibraries REMOVED
import PlanBuilderClient from '@/components/owner/PlanBuilderClient'

export const dynamic = 'force-dynamic'

export default async function PlanBuilderPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const plans = await getOwnerPlans()  // ← one DB call instead of two

  return <PlanBuilderClient plans={plans} />
  // libraries come from useOwner() context in the component
}