'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'
import type { ActionResult } from '@/lib/actions/auth'

/* ═══════════════════════════════════════════════════════════════
   CREATE LIBRARY  (step 4 — basic info)
═══════════════════════════════════════════════════════════════ */
const createLibrarySchema = z.object({
  name:        z.string().min(2).max(120).trim(),
  city:        z.string().min(1).max(80).trim(),
  state:       z.string().max(80).trim().optional().default(''),
  area:        z.string().max(120).trim().optional().default(''),
  address:     z.string().min(5).max(400).trim(),
  maps_link:   z.string().url().nullable().optional(),
  open_time:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  close_time:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  base_price:  z.number().positive().nullable().optional(),
  total_seats: z.number().int().positive().nullable().optional(),
  amenities:   z.array(z.string()).optional().default([]),
})

export type CreateLibraryInput = z.infer<typeof createLibrarySchema>

export async function createLibrary(
  input: CreateLibraryInput,
): Promise<ActionResult<{ libraryId: string }>> {
  const parsed = createLibrarySchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message }
  }

  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const {
    name, city, area, address,
    open_time, close_time, base_price, total_seats, amenities,
  } = parsed.data

  // 1. Insert library row (inactive until Go Live)
  const { data: library, error: libErr } = await supabase
    .from('libraries')
    .insert({
      owner_id:   user.id,
      name,
      city,
      area,
      address,
      open_time:  open_time  ?? null,
      close_time: close_time ?? null,
      base_price: base_price ?? null,
      is_active:  false,
    })
    .select('id')
    .single()

  if (libErr || !library) {
    console.error('createLibrary error:', libErr)
    return { success: false, error: libErr?.message ?? 'Failed to create library' }
  }

  const libraryId = library.id

  // 2. Link amenities (matched by slug stored in amenities.name)
  if (amenities.length > 0) {
    const { data: amenityRows } = await supabase
      .from('amenities')
      .select('id, name')
      .in('name', amenities)

    if (amenityRows?.length) {
      await supabase.from('library_amenities').insert(
        amenityRows.map(a => ({ library_id: libraryId, amenity_id: a.id })),
      )
    }
  }

  // 3. Auto-generate seat rows (A1…A8, B1…B8 …) if total_seats given
  if (total_seats && total_seats > 0) {
    const COLS  = 8
    const seats: { library_id: string; row_label: string; column_number: number; is_active: boolean }[] = []
    let count   = 0
    for (let r = 0; count < total_seats; r++) {
      const rowLabel = String.fromCharCode(65 + r) // A, B, C …
      for (let c = 1; c <= COLS && count < total_seats; c++) {
        seats.push({ library_id: libraryId, row_label: rowLabel, column_number: c, is_active: true })
        count++
      }
    }
    await supabase.from('seats').insert(seats)
  }

  return { success: true, data: { libraryId } }
}

/* ═══════════════════════════════════════════════════════════════
   UPLOAD LIBRARY PHOTO  (step 5 — photos)

   Why FormData?  Next.js server actions cannot receive a raw
   File/Blob — the client serialises it as multipart FormData
   and we reconstruct the ArrayBuffer on the server before
   piping it to Supabase Storage.
═══════════════════════════════════════════════════════════════ */
export async function uploadLibraryPhoto(
  formData: FormData,
): Promise<ActionResult<{ id: string; url: string }>> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const file      = formData.get('file')      as File   | null
  const libraryId = formData.get('libraryId') as string | null
  const isCover   = formData.get('isCover')   === '1'

  if (!file || !libraryId) {
    return { success: false, error: 'Missing file or libraryId' }
  }

  // Verify this library belongs to the current user
  const { data: lib } = await supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!lib) return { success: false, error: 'Library not found or access denied' }

  // Validate mime type + size (10 MB cap)
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    return { success: false, error: 'Only JPG, PNG, and WebP images are allowed' }
  }
  if (file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File size must be under 10 MB' }
  }

  // Unique storage path: <libraryId>/<timestamp>-<random>.<ext>
  const ext         = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const fileName    = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const storagePath = `${libraryId}/${fileName}`

  const { error: storageErr } = await supabase.storage
    .from('library-images')
    .upload(storagePath, await file.arrayBuffer(), {
      contentType:  file.type,
      cacheControl: '3600',
      upsert:       false,
    })

  if (storageErr) {
    console.error('uploadLibraryPhoto storage error:', storageErr)
    return { success: false, error: storageErr.message }
  }

  // Permanent public URL (no auth token required because bucket is public)
  const { data: { publicUrl } } = supabase.storage
    .from('library-images')
    .getPublicUrl(storagePath)

  // If cover photo — unset any previous cover first
  if (isCover) {
    await supabase
      .from('library_images')
      .update({ is_cover: false })
      .eq('library_id', libraryId)
      .eq('is_cover', true)
  }

  // Insert row in library_images table
  const { data: imgRow, error: insertErr } = await supabase
    .from('library_images')
    .insert({ library_id: libraryId, image_url: publicUrl, is_cover: isCover })
    .select('id')
    .single()

  if (insertErr || !imgRow) {
    // Best-effort: remove the orphaned file from storage
    await supabase.storage.from('library-images').remove([storagePath])
    return { success: false, error: insertErr?.message ?? 'Failed to save photo record' }
  }

  return { success: true, data: { id: imgRow.id, url: publicUrl } }
}

/* ═══════════════════════════════════════════════════════════════
   DELETE LIBRARY PHOTO  (photos page — × button)
═══════════════════════════════════════════════════════════════ */
export async function deleteLibraryPhoto(
  imageId: string,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Fetch the row and verify ownership through the libraries join
  const { data: img } = await supabase
    .from('library_images')
    .select('id, image_url, library_id, libraries(owner_id)')
    .eq('id', imageId)
    .maybeSingle()

  if (!img) return { success: false, error: 'Photo not found' }

  // Normalise join result (Supabase can return object or array)
  const ownerRaw = img.libraries
  const ownerId  = Array.isArray(ownerRaw)
    ? ownerRaw[0]?.owner_id
    : (ownerRaw as any)?.owner_id

  if (ownerId !== user.id) return { success: false, error: 'Access denied' }

  // Extract storage path from the public URL
  // URL shape: https://<ref>.supabase.co/storage/v1/object/public/library-images/<path>
  try {
    const urlObj      = new URL(img.image_url)
    const marker      = '/library-images/'
    const afterBucket = urlObj.pathname.split(marker)[1] ?? ''
    if (afterBucket) {
      const { error: storageErr } = await supabase.storage
        .from('library-images')
        .remove([afterBucket])
      if (storageErr) {
        console.warn('deleteLibraryPhoto: storage remove warning:', storageErr.message)
      }
    }
  } catch {
    console.warn('deleteLibraryPhoto: could not parse image URL, skipping storage removal')
  }

  const { error: deleteErr } = await supabase
    .from('library_images')
    .delete()
    .eq('id', imageId)

  if (deleteErr) return { success: false, error: deleteErr.message }

  return { success: true, data: undefined }
}

/* ═══════════════════════════════════════════════════════════════
   GET LIBRARY ONBOARDING SUMMARY  (go-live checklist)
═══════════════════════════════════════════════════════════════ */
export type LibrarySummary = {
  name:       string
  city:       string
  area:       string
  hasAddress: boolean
  basePrice:  number | null
  openTime:   string
  closeTime:  string
  totalSeats: number
  photoCount: number
  coverUrl:   string | null
}

export async function getLibraryOnboardingSummary(
  libraryId: string,
): Promise<LibrarySummary | null> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: lib } = await supabase
    .from('libraries')
    .select('name, city, area, address, base_price, open_time, close_time')
    .eq('id', libraryId)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!lib) return null

  // Active seat count
  const { count: seatCount } = await supabase
    .from('seats')
    .select('*', { count: 'exact', head: true })
    .eq('library_id', libraryId)
    .eq('is_active', true)

  // Photos
  const { data: photos } = await supabase
    .from('library_images')
    .select('image_url, is_cover')
    .eq('library_id', libraryId)
    .order('is_cover', { ascending: false }) // covers first

  const coverUrl = photos?.find(p => p.is_cover)?.image_url
    ?? photos?.[0]?.image_url
    ?? null

  // open_time / close_time come back as "HH:MM:SS" from Postgres — trim to "HH:MM"
  const fmt = (t: string | null) => (t ? String(t).slice(0, 5) : '–')

  return {
    name:       lib.name       ?? '',
    city:       lib.city       ?? '',
    area:       lib.area       ?? '',
    hasAddress: !!(lib.address?.trim()),
    basePrice:  lib.base_price  != null ? Number(lib.base_price)  : null,
    openTime:   fmt(lib.open_time),
    closeTime:  fmt(lib.close_time),
    totalSeats: seatCount ?? 0,
    photoCount: photos?.length ?? 0,
    coverUrl,
  }
}

/* ═══════════════════════════════════════════════════════════════
   PUBLISH LIBRARY  (go-live — the big green button)

   Guards:
    • At least 1 photo uploaded
    • At least 1 active seat configured
   Sets is_active = true, making the library visible to students.
═══════════════════════════════════════════════════════════════ */
export async function publishLibrary(
  libraryId: string,
): Promise<ActionResult> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Guard: at least 1 photo
  const { count: photoCount } = await supabase
    .from('library_images')
    .select('*', { count: 'exact', head: true })
    .eq('library_id', libraryId)

  if (!photoCount || photoCount === 0) {
    return { success: false, error: 'Upload at least one photo before going live' }
  }

  // Guard: at least 1 active seat
  const { count: seatCount } = await supabase
    .from('seats')
    .select('*', { count: 'exact', head: true })
    .eq('library_id', libraryId)
    .eq('is_active', true)

  if (!seatCount || seatCount === 0) {
    return { success: false, error: 'Configure at least one seat before going live' }
  }

  // Flip is_active — the eq('owner_id') acts as an ownership guard
  const { error } = await supabase
    .from('libraries')
    .update({ is_active: true })
    .eq('id', libraryId)
    .eq('owner_id', user.id)

  if (error) {
    console.error('publishLibrary error:', error)
    return { success: false, error: error.message }
  }

  return { success: true, data: undefined }
}