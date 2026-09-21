import { supabase } from '../../lib/supabaseClient'

const PROFILE_AVATAR_BUCKET = 'profile-avatars'
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const ALLOWED_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function extensionForMimeType(type: string): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      throw new Error('Unsupported avatar file type.')
  }
}

export async function uploadMyProfileAvatar(file: File): Promise<string> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error('Avatar must be a JPEG, PNG, or WebP image.')
  }

  if (file.size <= 0) {
    throw new Error('Avatar file is empty.')
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Avatar must be 5 MB or smaller.')
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    throw new Error('Authentication required.')
  }

  const extension = extensionForMimeType(file.type)
  const objectName = `${user.id}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(objectName, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    throw uploadError
  }

  return objectName
}

export async function createProfileAvatarSignedUrls(
  avatarPaths: string[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  const paths = avatarPaths.map((path) => path.trim()).filter(Boolean)
  if (!paths.length) return new Map()
  const { data, error } = await supabase.storage.from(PROFILE_AVATAR_BUCKET).createSignedUrls(paths, expiresInSeconds)
  if (error || !data || data.length !== paths.length) throw error ?? new Error('Unable to load profile avatars.')
  const urls = new Map<string, string>()
  data.forEach((item, index) => { if (item.signedUrl) urls.set(paths[index], item.signedUrl) })
  return urls
}

export async function createProfileAvatarSignedUrl(
  avatarPath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const normalizedPath = avatarPath.trim()

  if (!normalizedPath) {
    throw new Error('Avatar path is required.')
  }

  const { data, error } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(normalizedPath, expiresInSeconds)

  if (error) {
    throw error
  }

  return data.signedUrl
}
