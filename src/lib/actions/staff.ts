'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'

export type AssignedLibrary = {
  id: string
  name: string
  area: string
  city: string
  assigned: boolean
}

/**
 * Fetch libraries the current staff user is assigned to.
 * Returns empty array if not yet assigned to any library.
 */
export async function getStaffAssignedLibraries(): Promise<AssignedLibrary[]> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('staff')
    .select(`
      library_id,
      libraries (
        id,
        name,
        area,
        city
      )
    `)
    .eq('user_id', user.id)

  if (error || !data) return []

  return data.map((row: any) => ({
    id:       row.libraries.id,
    name:     row.libraries.name,
    area:     row.libraries.area ?? '',
    city:     row.libraries.city ?? '',
    assigned: true,
  }))
}