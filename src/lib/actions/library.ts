'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireActionRole } from '@/lib/auth/guards'
import { z } from 'zod'
import type { ActionResult } from '@/lib/actions/auth'

/* ─── Shared Zod schema ─────────────────────────────────────────────────────── */
const librarySchema = z.object({
  name:                z.string().min(2).max(120).trim(),
  state:               z.string().min(1).max(80).trim(),
  description:      z.string().max(400).trim().optional(),
  city:                z.string().min(1).max(80).trim(),
  area:                z.string().min(1).max(120).trim(),
  address:             z.string().min(5).max(400).trim(),
  amenity_ids:         z.array(z.string().uuid()).min(1),
  latitude:            z.number().nullable().optional(),
  longitude:           z.number().nullable().optional(),
  razorpay_account_id: z.string().max(100).trim().nullable().optional(),
})

export type LibraryFormInput = z.infer<typeof librarySchema>

/* ═══════════════════════════════════════════════════════════════
   GET LIBRARY FOR EDIT
═══════════════════════════════════════════════════════════════ */
export type LibraryForEdit = {
  id:                  string
  name:                string
  state:               string
  city:                string
  area:                string
  address:             string
  description:         string
  amenityIds:          string[]      // UUIDs
  latitude:            number | null
  longitude:           number | null
  razorpay_account_id: string
}

export async function getLibraryForEdit(
  libraryId: string,
): Promise<LibraryForEdit | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: lib } = await supabase
    .from('libraries')
    .select('id, name, state, city, area, address, latitude, longitude, razorpay_account_id')
    .eq('id', libraryId)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!lib) return null

  // Fetch linked amenity IDs directly — no join needed
  const { data: linkedAmenities } = await supabase
    .from('library_amenities')
    .select('amenity_id')
    .eq('library_id', libraryId)

  const amenityIds: string[] = (linkedAmenities ?? []).map((r: any) => r.amenity_id)

  // Active seat count
  const { count: seatCount } = await supabase
    .from('seats')
    .select('*', { count: 'exact', head: true })
    .eq('library_id', libraryId)
    .eq('is_active', true)

  const fmt = (t: string | null) => (t ? String(t).slice(0, 5) : '')

  return {
    id:                  lib.id,
    name:                lib.name                ?? '',
    state:               (lib as any).state      ?? '',
    description:         (lib as any).description ?? '',
    city:                lib.city                ?? '',
    area:                lib.area                ?? '',
    address:             lib.address             ?? '',
    amenityIds,
    latitude:            lib.latitude   != null ? Number(lib.latitude)   : null,
    longitude:           lib.longitude  != null ? Number(lib.longitude)  : null,
    razorpay_account_id: lib.razorpay_account_id ?? '',
  }
}

/* ═══════════════════════════════════════════════════════════════
   CREATE LIBRARY
═══════════════════════════════════════════════════════════════ */
export async function createLibrary(
  input: LibraryFormInput,
): Promise<ActionResult<{ libraryId: string }>> {
  const parsed = librarySchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const gate = await requireActionRole('owner')
  if (!gate.ok) return gate.error
  const { supabase, user } = gate

  const {
    name, state, city, area, address, description, amenity_ids,
    latitude, longitude, razorpay_account_id,
  } = parsed.data

  const { data: library, error: libErr } = await supabase
    .from('libraries')
    .insert({
      owner_id:            user.id,
      name,
      state:               state || null,
      city,
      area,
      address,
      description,
      latitude:            latitude            ?? null,
      longitude:           longitude           ?? null,
      razorpay_account_id: razorpay_account_id ?? null,
      is_active:           false,
    } as any)
    .select('id')
    .single()

  if (libErr || !library) {
    console.error('createLibrary error:', libErr)
    return { success: false, error: libErr?.message ?? 'Failed to create library' }
  }

  const libraryId = library.id

  await syncAmenities(supabase, libraryId, amenity_ids)
  

  return { success: true, data: { libraryId } }
}

/* ═══════════════════════════════════════════════════════════════
   UPDATE LIBRARY
═══════════════════════════════════════════════════════════════ */
export async function updateLibrary(
  libraryId: string,
  input: LibraryFormInput,
): Promise<ActionResult<{ libraryId: string }>> {
  const parsed = librarySchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: existing } = await supabase
    .from('libraries').select('id').eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!existing) return { success: false, error: 'Library not found or access denied' }

  const {
    name, state, city, area, address,
   
    amenity_ids, latitude, longitude, razorpay_account_id,
  } = parsed.data

  const { error: updateErr } = await supabase
    .from('libraries')
    .update({
      name,
      state:               state || null,
      city,
      area,
      address,
   
      latitude:            latitude            ?? null,
      longitude:           longitude           ?? null,
      razorpay_account_id: razorpay_account_id ?? null,
    } as any)
    .eq('id', libraryId)
    .eq('owner_id', user.id)

  if (updateErr) {
    console.error('updateLibrary error:', updateErr)
    return { success: false, error: updateErr.message }
  }

  await syncAmenities(supabase, libraryId, amenity_ids)

  return { success: true, data: { libraryId } }
}

/* ═══════════════════════════════════════════════════════════════
   PRIVATE HELPERS
═══════════════════════════════════════════════════════════════ */
async function syncAmenities(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  libraryId: string,
  amenityIds: string[],
) {
  const { error: deleteErr } = await supabase
    .from('library_amenities')
    .delete()
    .eq('library_id', libraryId)

  if (deleteErr) {
    console.error('syncAmenities: delete failed', deleteErr)
    return
  }

  if (!amenityIds.length) return

  const { error: linkErr } = await supabase
    .from('library_amenities')
    .insert(amenityIds.map(amenity_id => ({ library_id: libraryId, amenity_id })))

  if (linkErr) console.error('syncAmenities: insert failed', linkErr)
}



/* ═══════════════════════════════════════════════════════════════
   UPLOAD LIBRARY PHOTO
═══════════════════════════════════════════════════════════════ */
export async function uploadLibraryPhoto(
  formData: FormData,
): Promise<ActionResult<{ id: string; url: string; isCover: boolean }>> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const file      = formData.get('file')      as File   | null
  const libraryId = formData.get('libraryId') as string | null
  const isCover   = formData.get('isCover')   === '1'

  if (!file || !libraryId) return { success: false, error: 'Missing file or libraryId' }

  const { data: lib } = await supabase
    .from('libraries').select('id').eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!lib) return { success: false, error: 'Library not found or access denied' }

  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) return { success: false, error: 'Only JPG, PNG, and WebP images are allowed' }
  if (file.size > 10 * 1024 * 1024) return { success: false, error: 'File size must be under 10 MB' }

  const ext         = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const prefix      = isCover ? 'cover' : 'photo'
  const rand        = Math.random().toString(36).slice(2)
  const storagePath = `${libraryId}/${prefix}-${Date.now()}-${rand}.${ext}`

  const { error: storageErr } = await supabase.storage
    .from('library-images')
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type, cacheControl: '3600', upsert: false,
    })

  if (storageErr) {
    console.error('uploadLibraryPhoto storage error:', storageErr)
    return { success: false, error: storageErr.message }
  }

  const { data: { publicUrl } } = supabase.storage.from('library-images').getPublicUrl(storagePath)

  const { count: existingCount } = await supabase
    .from('library_images').select('*', { count: 'exact', head: true }).eq('library_id', libraryId)

  const effectiveIsCover = isCover || (existingCount === 0)

  if (effectiveIsCover) {
    await supabase.from('library_images')
      .update({ is_cover: false }).eq('library_id', libraryId).eq('is_cover', true)
  }

  const { data: imgRow, error: insertErr } = await supabase
    .from('library_images')
    .insert({ library_id: libraryId, image_url: publicUrl, is_cover: effectiveIsCover })
    .select('id').single()

  if (insertErr || !imgRow) {
    await supabase.storage.from('library-images').remove([storagePath])
    return { success: false, error: insertErr?.message ?? 'Failed to save photo record' }
  }

  return { success: true, data: { id: imgRow.id, url: publicUrl, isCover: effectiveIsCover } }
}

/* ═══════════════════════════════════════════════════════════════
   GET LIBRARY PHOTOS
═══════════════════════════════════════════════════════════════ */
export type LibraryPhotoRow = { id: string; url: string; isCover: boolean }

export async function getLibraryPhotos(libraryId: string): Promise<LibraryPhotoRow[]> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: lib } = await supabase
    .from('libraries').select('id').eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!lib) return []

  const { data } = await supabase
    .from('library_images')
    .select('id, image_url, is_cover')
    .eq('library_id', libraryId)
    .order('is_cover', { ascending: false })
    .order('created_at', { ascending: true })

  return (data ?? []).map(r => ({ id: r.id, url: r.image_url, isCover: r.is_cover ?? false }))
}

/* ═══════════════════════════════════════════════════════════════
   SET COVER PHOTO
═══════════════════════════════════════════════════════════════ */
export async function setCoverPhoto(imageId: string, libraryId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('id').eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!lib) return { success: false, error: 'Library not found or access denied' }

  await supabase.from('library_images')
    .update({ is_cover: false }).eq('library_id', libraryId).eq('is_cover', true)

  const { error } = await supabase.from('library_images')
    .update({ is_cover: true }).eq('id', imageId).eq('library_id', libraryId)

  if (error) return { success: false, error: error.message }
  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════
   DELETE LIBRARY PHOTO
═══════════════════════════════════════════════════════════════ */
export async function deleteLibraryPhoto(imageId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: img } = await supabase
    .from('library_images')
    .select('id, image_url, is_cover, library_id, libraries(owner_id)')
    .eq('id', imageId).maybeSingle()

  if (!img) return { success: false, error: 'Photo not found' }

  const ownerRaw = img.libraries
  const ownerId  = Array.isArray(ownerRaw) ? ownerRaw[0]?.owner_id : (ownerRaw as any)?.owner_id
  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  try {
    const afterBucket = new URL(img.image_url).pathname.split('/library-images/')[1] ?? ''
    if (afterBucket) await supabase.storage.from('library-images').remove([afterBucket])
  } catch {
    console.warn('deleteLibraryPhoto: could not parse image URL')
  }

  const { error: deleteErr } = await supabase.from('library_images').delete().eq('id', imageId)
  if (deleteErr) return { success: false, error: deleteErr.message }

  if (img.is_cover) {
    const { data: next } = await supabase
      .from('library_images').select('id')
      .eq('library_id', img.library_id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (next) {
      await supabase.from('library_images').update({ is_cover: true }).eq('id', next.id)
    }
  }

  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════
   GET LIBRARY ONBOARDING SUMMARY
═══════════════════════════════════════════════════════════════ */
export type LibrarySummary = {
  name: string; city: string; area: string
  hasAddress: boolean; 
  photoCount: number; coverUrl: string | null
}

export async function getLibraryOnboardingSummary(libraryId: string): Promise<LibrarySummary | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: lib } = await supabase
    .from('libraries')
    .select('name, city, area, address')
    .eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!lib) return null



  const { data: photos } = await supabase
    .from('library_images').select('image_url, is_cover')
    .eq('library_id', libraryId).order('is_cover', { ascending: false })

  const fmt = (t: string | null) => (t ? String(t).slice(0, 5) : '–')

  return {
    name:       lib.name      ?? '',
    city:       lib.city      ?? '',
    area:       lib.area      ?? '',
    hasAddress: !!(lib.address?.trim()),
    photoCount: photos?.length ?? 0,
    coverUrl:   photos?.find(p => p.is_cover)?.image_url ?? photos?.[0]?.image_url ?? null,
  }
}

/* ═══════════════════════════════════════════════════════════════
   PUBLISH LIBRARY
═══════════════════════════════════════════════════════════════ */
export async function publishLibrary(libraryId: string): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: lib } = await supabase
    .from('libraries').select('id').eq('id', libraryId).eq('owner_id', user.id).maybeSingle()
  if (!lib) return { success: false, error: 'Library not found or access denied' }

  const { count: photoCount } = await supabase
    .from('library_images').select('*', { count: 'exact', head: true }).eq('library_id', libraryId)
  if (!photoCount || photoCount === 0)
    return { success: false, error: 'Upload at least one photo before going live' }

  

  const { error } = await supabase
    .from('libraries').update({ is_active: true } as any).eq('id', libraryId).eq('owner_id', user.id)

  if (error) { console.error('publishLibrary error:', error); return { success: false, error: error.message } }
  return { success: true, data: undefined }
}