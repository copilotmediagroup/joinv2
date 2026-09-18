import { supabase } from '../../lib/supabaseClient'

const PROFILE_MUTATION_TIMEOUT_MS = 12_000
const PROFILE_MUTATION_RETRY_DELAY_MS = 250
const PROFILE_MUTATION_MAX_ATTEMPTS = 2

function profileRetryDelay() {
  return new Promise((resolve) => window.setTimeout(resolve, PROFILE_MUTATION_RETRY_DELAY_MS))
}

export type ProfileGender = 'male' | 'female'
export type ProfileCompletionState = 'incomplete' | 'complete'

export type MyProfile = {
  userId: string
  displayName: string | null
  avatarPath: string | null
  bio: string | null
  birthDate: string | null
  gender: ProfileGender | null
  homeCityId: string | null
  cityName: string | null
  citySlug: string | null
  stateCode: string | null
  stateName: string | null
  completionState: ProfileCompletionState
}

export type UpdateMyProfileInput = {
  displayName: string
  avatarPath: string
  bio: string | null
}

type ProfileRpcRow = {
  user_id: string
  display_name: string | null
  avatar_path: string | null
  bio: string | null
  birth_date: string | null
  gender: ProfileGender | null
  home_city_id: string | null
  city_name: string | null
  city_slug: string | null
  state_code: string | null
  state_name: string | null
  completion_state: ProfileCompletionState
}

function requireSingleProfileRow(
  value: ProfileRpcRow | ProfileRpcRow[] | null,
  operation: string,
): ProfileRpcRow {
  const rows = Array.isArray(value) ? value : value ? [value] : []

  if (rows.length !== 1) {
    throw new Error(`${operation} returned an unexpected profile result.`)
  }

  return rows[0]
}

function mapProfileRow(row: ProfileRpcRow): MyProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    bio: row.bio,
    birthDate: row.birth_date,
    gender: row.gender,
    homeCityId: row.home_city_id,
    cityName: row.city_name,
    citySlug: row.city_slug,
    stateCode: row.state_code,
    stateName: row.state_name,
    completionState: row.completion_state,
  }
}

export async function getMyProfile(): Promise<MyProfile> {
  const { data, error } = await supabase.rpc('get_my_profile')

  if (error) {
    throw error
  }

  return mapProfileRow(
    requireSingleProfileRow(
      data as ProfileRpcRow | ProfileRpcRow[] | null,
      'Profile read',
    ),
  )
}

export async function updateMyProfile(
  input: UpdateMyProfileInput,
): Promise<MyProfile> {
  const displayName = input.displayName.trim()
  const avatarPath = input.avatarPath.trim()
  const bio = input.bio?.trim() || null

  if (!displayName) {
    throw new Error('Display name is required.')
  }

  if (displayName.length > 80) {
    throw new Error('Display name must be 80 characters or fewer.')
  }

  if (!avatarPath) {
    throw new Error('Avatar is required.')
  }

  if (bio !== null && bio.length > 120) {
    throw new Error('Bio must be 120 characters or fewer.')
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt < PROFILE_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PROFILE_MUTATION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('update_my_profile', {
          p_display_name: displayName,
          p_avatar_path: avatarPath,
          p_bio: bio,
        })
        .abortSignal(controller.signal)

      if (!error) {
        return mapProfileRow(
          requireSingleProfileRow(
            data as ProfileRpcRow | ProfileRpcRow[] | null,
            'Profile update',
          ),
        )
      }

      lastError = error
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= PROFILE_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await profileRetryDelay()
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to update profile.')
}

export type MyIdentityPhoto = {
  id: string
  objectPath: string
  position: number
  createdAt: string
}

type IdentityPhotoRpcRow = {
  id: string
  object_path: string
  position: number
  created_at: string
}

function mapIdentityPhotoRow(
  row: IdentityPhotoRpcRow,
): MyIdentityPhoto {
  return {
    id: row.id,
    objectPath: row.object_path,
    position: row.position,
    createdAt: row.created_at,
  }
}

function mapIdentityPhotoRows(
  value: IdentityPhotoRpcRow[] | null,
): MyIdentityPhoto[] {
  return (value ?? [])
    .map(mapIdentityPhotoRow)
    .sort((left, right) => left.position - right.position)
}

function requireSingleIdentityPhotoRow(
  value: IdentityPhotoRpcRow | IdentityPhotoRpcRow[] | null,
  operation: string,
): IdentityPhotoRpcRow {
  const rows = Array.isArray(value) ? value : value ? [value] : []

  if (rows.length !== 1) {
    throw new Error(
      `${operation} returned an unexpected identity-photo result.`,
    )
  }

  return rows[0]
}

export async function getMyIdentityPhotos(): Promise<MyIdentityPhoto[]> {
  const { data, error } = await supabase.rpc(
    'get_my_identity_photos',
  )

  if (error) {
    throw error
  }

  return mapIdentityPhotoRows(
    data as IdentityPhotoRpcRow[] | null,
  )
}

export async function addMyIdentityPhoto(
  objectPath: string,
): Promise<MyIdentityPhoto> {
  const normalizedObjectPath = objectPath.trim()

  if (!normalizedObjectPath) {
    throw new Error('Identity photo path is required.')
  }

  const { data, error } = await supabase.rpc(
    'add_my_identity_photo',
    {
      p_object_path: normalizedObjectPath,
    },
  )

  if (error) {
    throw error
  }

  return mapIdentityPhotoRow(
    requireSingleIdentityPhotoRow(
      data as IdentityPhotoRpcRow | IdentityPhotoRpcRow[] | null,
      'Identity photo add',
    ),
  )
}

export async function removeMyIdentityPhoto(
  photoId: string,
): Promise<MyIdentityPhoto> {
  const normalizedPhotoId = photoId.trim()

  if (!normalizedPhotoId) {
    throw new Error('Identity photo id is required.')
  }

  const { data, error } = await supabase.rpc(
    'remove_my_identity_photo',
    {
      p_photo_id: normalizedPhotoId,
    },
  )

  if (error) {
    throw error
  }

  return mapIdentityPhotoRow(
    requireSingleIdentityPhotoRow(
      data as IdentityPhotoRpcRow | IdentityPhotoRpcRow[] | null,
      'Identity photo removal',
    ),
  )
}

export async function reorderMyIdentityPhotos(
  photoIds: string[],
): Promise<MyIdentityPhoto[]> {
  const normalizedPhotoIds = photoIds.map(
    (photoId) => photoId.trim(),
  )

  if (
    normalizedPhotoIds.some((photoId) => !photoId) ||
    new Set(normalizedPhotoIds).size !== normalizedPhotoIds.length
  ) {
    throw new Error(
      'Identity photo order must contain distinct photo ids.',
    )
  }

  const { data, error } = await supabase.rpc(
    'reorder_my_identity_photos',
    {
      p_photo_ids: normalizedPhotoIds,
    },
  )

  if (error) {
    throw error
  }

  return mapIdentityPhotoRows(
    data as IdentityPhotoRpcRow[] | null,
  )
}

const IDENTITY_PHOTO_BUCKET = 'profile-avatars'
const IDENTITY_PHOTO_MAX_BYTES = 5 * 1024 * 1024
const MAX_IDENTITY_PHOTOS = 5

const IDENTITY_PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function validateIdentityPhotoFile(file: File): string {
  const extension = IDENTITY_PHOTO_EXTENSIONS[file.type]

  if (!extension) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.')
  }

  if (file.size > IDENTITY_PHOTO_MAX_BYTES) {
    throw new Error('Profile photos must be 5 MB or smaller.')
  }

  return extension
}

async function removeIdentityPhotoStorageObject(
  objectPath: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(IDENTITY_PHOTO_BUCKET)
    .remove([objectPath])

  if (error) {
    throw error
  }
}

export async function uploadMyIdentityPhoto(
  file: File,
): Promise<MyIdentityPhoto> {
  const extension = validateIdentityPhotoFile(file)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    throw new Error('Authentication is required.')
  }

  const objectPath =
    `${user.id}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(IDENTITY_PHOTO_BUCKET)
    .upload(
      objectPath,
      file,
      {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      },
    )

  if (uploadError) {
    throw uploadError
  }

  try {
    return await addMyIdentityPhoto(objectPath)
  } catch (error) {
    try {
      await removeIdentityPhotoStorageObject(objectPath)
    } catch (cleanupError) {
      console.error(
        'Identity photo metadata add failed and uploaded object cleanup also failed.',
        {
          objectPath,
          cleanupError,
        },
      )
    }

    throw error
  }
}

export async function removeMyIdentityPhotoWithStorage(
  photoId: string,
): Promise<MyIdentityPhoto> {
  const removed = await removeMyIdentityPhoto(photoId)

  try {
    await removeIdentityPhotoStorageObject(
      removed.objectPath,
    )
  } catch (error) {
    console.error(
      'Identity photo metadata was removed but storage cleanup failed.',
      {
        objectPath: removed.objectPath,
        error,
      },
    )

    throw new Error(
      'Photo was removed from your profile, but its stored file could not be cleaned up.',
      { cause: error },
    )
  }

  return removed
}

export type SaveMyProfileWithIdentityGalleryInput = {
  displayName: string
  avatarPath: string
  bio: string | null
  expectedGalleryObjectPaths: string[]
  galleryObjectPaths: string[]
}

export type SaveMyProfileWithIdentityGalleryResult = {
  profile: MyProfile
  identityPhotos: MyIdentityPhoto[]
  removedObjectPaths: string[]
}

type AtomicProfileSaveRpcRow = ProfileRpcRow & {
  identity_photos: IdentityPhotoRpcRow[] | null
  removed_object_paths: string[] | null
}

function requireSingleAtomicProfileSaveRow(
  value:
    | AtomicProfileSaveRpcRow
    | AtomicProfileSaveRpcRow[]
    | null,
): AtomicProfileSaveRpcRow {
  const rows = Array.isArray(value)
    ? value
    : value
      ? [value]
      : []

  if (rows.length !== 1) {
    throw new Error(
      'Atomic profile save returned an unexpected result.',
    )
  }

  return rows[0]
}

export async function uploadMyIdentityPhotoStorageObject(
  file: File,
): Promise<string> {
  const extension = validateIdentityPhotoFile(file)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    throw new Error('Authentication is required.')
  }

  const objectPath =
    `${user.id}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(IDENTITY_PHOTO_BUCKET)
    .upload(
      objectPath,
      file,
      {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      },
    )

  if (uploadError) {
    throw uploadError
  }

  return objectPath
}

export async function removeMyProfileStorageObjects(
  objectPaths: string[],
): Promise<void> {
  const normalizedPaths = Array.from(
    new Set(
      objectPaths
        .map((objectPath) => objectPath.trim())
        .filter(Boolean),
    ),
  )

  if (normalizedPaths.length === 0) {
    return
  }

  const { error } = await supabase.storage
    .from(IDENTITY_PHOTO_BUCKET)
    .remove(normalizedPaths)

  if (error) {
    throw error
  }
}

export async function saveMyProfileWithIdentityGallery(
  input: SaveMyProfileWithIdentityGalleryInput,
): Promise<SaveMyProfileWithIdentityGalleryResult> {
  const displayName = input.displayName.trim()
  const avatarPath = input.avatarPath.trim()
  const bio = input.bio?.trim() || null

  const expectedGalleryObjectPaths =
    input.expectedGalleryObjectPaths.map(
      (objectPath) => objectPath.trim(),
    )

  const galleryObjectPaths =
    input.galleryObjectPaths.map(
      (objectPath) => objectPath.trim(),
    )

  if (!displayName) {
    throw new Error('Display name is required.')
  }

  if (displayName.length > 80) {
    throw new Error(
      'Display name must be 80 characters or fewer.',
    )
  }

  if (!avatarPath) {
    throw new Error('Avatar is required.')
  }

  if (bio !== null && bio.length > 120) {
    throw new Error('Bio must be 120 characters or fewer.')
  }

  if (
    expectedGalleryObjectPaths.some(
      (objectPath) => !objectPath,
    )
  ) {
    throw new Error(
      'Expected identity gallery contains an invalid photo.',
    )
  }

  if (
    galleryObjectPaths.some(
      (objectPath) => !objectPath,
    )
  ) {
    throw new Error(
      'Identity gallery contains an invalid photo.',
    )
  }

  if (galleryObjectPaths.length > MAX_IDENTITY_PHOTOS) {
    throw new Error(
      'Identity gallery cannot contain more than five additional photos.',
    )
  }

  if (
    new Set(galleryObjectPaths).size !==
    galleryObjectPaths.length
  ) {
    throw new Error(
      'Identity gallery cannot contain duplicate photos.',
    )
  }

  const { data, error } = await supabase.rpc(
    'save_my_profile_with_identity_gallery',
    {
      p_display_name: displayName,
      p_avatar_path: avatarPath,
      p_bio: bio,
      p_expected_gallery_object_paths:
        expectedGalleryObjectPaths,
      p_gallery_object_paths: galleryObjectPaths,
    },
  )

  if (error) {
    throw error
  }

  const row = requireSingleAtomicProfileSaveRow(
    data as
      | AtomicProfileSaveRpcRow
      | AtomicProfileSaveRpcRow[]
      | null,
  )

  return {
    profile: mapProfileRow(row),
    identityPhotos: mapIdentityPhotoRows(
      row.identity_photos ?? [],
    ),
    removedObjectPaths: Array.isArray(
      row.removed_object_paths,
    )
      ? row.removed_object_paths
      : [],
  }
}
