import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl, createProfileAvatarSignedUrls } from '../onboarding/avatarClient'

const MOMENT_BUCKET = 'signal-moments'

export type PublicSignalProfile = {
  userId: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  age: number | null
  cityName: string | null
  stateCode: string | null
  signalsJoined: number
  completedMeetups: number
  verifiedShowUps: number
  connectionState: 'self' | 'connected' | 'none'
}

export type PublicProfileMoment = {
  momentId: string
  caption: string | null
  publishedAt: string
  activityName: string
  cityName: string
  stateCode: string
  venueName: string | null
  signalCount: number
  commentCount: number
  media: Array<{ storagePath: string; mediaKind: 'image' | 'video'; url: string }>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid public profile: ${field}`)
  return value
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export async function getPublicSignalProfile(userId: string): Promise<PublicSignalProfile> {
  const { data, error } = await supabase.rpc('get_signal_public_profile', { p_user_id: userId })
  if (error) throw new Error(error.message || 'Unable to load profile')
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid public profile response')
  const row = data as Record<string, unknown>
  const avatarPath = optionalText(row.avatarPath)
  const state = text(row.connectionState, 'connectionState')
  if (state !== 'self' && state !== 'connected' && state !== 'none') throw new Error('Invalid connection state')
  return {
    userId: text(row.userId, 'userId'), displayName: text(row.displayName, 'displayName'),
    avatarUrl: avatarPath ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null) : null,
    bio: optionalText(row.bio), age: typeof row.age === 'number' ? row.age : null,
    cityName: optionalText(row.cityName), stateCode: optionalText(row.stateCode),
    signalsJoined: Number(row.signalsJoined) || 0, completedMeetups: Number(row.completedMeetups) || 0,
    verifiedShowUps: Number(row.verifiedShowUps) || 0, connectionState: state,
  }
}

export const PUBLIC_PROFILE_MOMENT_PAGE_SIZE = 12
export type PublicProfileMomentCursor = { publishedAt: string; momentId: string }
export type PublicProfileMomentPage = { moments: PublicProfileMoment[]; hasMore: boolean }

export async function getPublicProfileMoments(userId: string, cursor: PublicProfileMomentCursor | null = null): Promise<PublicProfileMomentPage> {
  const { data, error } = await supabase.rpc('get_signal_public_profile_moments_page', {
    p_user_id: userId,
    p_after_published_at: cursor?.publishedAt ?? null,
    p_after_id: cursor?.momentId ?? null,
    p_limit: PUBLIC_PROFILE_MOMENT_PAGE_SIZE + 1,
  })
  if (error) throw new Error(error.message || 'Unable to load Signal Life')
  if (!Array.isArray(data)) throw new Error('Invalid Signal Life response')
  const rows = (data as Record<string, unknown>[]).slice(0, PUBLIC_PROFILE_MOMENT_PAGE_SIZE)
  const mediaByRow = rows.map((row) => (Array.isArray(row.media) ? row.media as Record<string, unknown>[] : []).map((item) => {
    const storagePath = text(item.storagePath, 'storagePath')
    const mediaKind = text(item.mediaKind, 'mediaKind')
    if (mediaKind !== 'image' && mediaKind !== 'video') throw new Error('Invalid Signal media')
    return { storagePath, mediaKind: mediaKind as 'image' | 'video' }
  }))
  const paths = mediaByRow.flatMap((media) => media.map((item) => item.storagePath))
  const signedByPath = new Map<string, string>()
  if (paths.length) {
    const { data: signed, error: signError } = await supabase.storage.from(MOMENT_BUCKET).createSignedUrls(paths, 3600)
    if (signError || !signed || signed.length !== paths.length) throw new Error(signError?.message || 'Unable to load Signal media')
    signed.forEach((item, index) => {
      if (!item.signedUrl) throw new Error('Unable to load Signal media')
      signedByPath.set(paths[index], item.signedUrl)
    })
  }
  return {
    hasMore: data.length > PUBLIC_PROFILE_MOMENT_PAGE_SIZE,
    moments: rows.map((row, index) => ({
      momentId: text(row.moment_id, 'moment_id'), caption: optionalText(row.caption),
      publishedAt: text(row.published_at, 'published_at'), activityName: text(row.activity_name, 'activity_name'),
      cityName: text(row.city_name, 'city_name'), stateCode: text(row.state_code, 'state_code'),
      venueName: optionalText(row.venue_name), signalCount: Number(row.signal_count) || 0,
      commentCount: Number(row.comment_count) || 0,
      media: mediaByRow[index].map((item) => ({ ...item, url: signedByPath.get(item.storagePath) ?? '' })),
    })),
  }
}

export type PublicProfileConnection = {
  connectionId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  connectedAt: string
}
export type PublicProfileConnectionCursor = { connectedAt: string; connectionId: string }
export type PublicProfileConnectionPage = { connections: PublicProfileConnection[]; hasMore: boolean }
export const PUBLIC_PROFILE_CONNECTION_PAGE_SIZE = 24

export async function getPublicProfileConnectionCount(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_signal_public_profile_connection_count', { p_user_id: userId })
  if (error) throw new Error(error.message || 'Unable to load connection count')
  const count = Number(data)
  if (!Number.isInteger(count) || count < 0) throw new Error('Invalid public connection count response')
  return count
}

export async function getPublicProfileConnections(userId: string, cursor: PublicProfileConnectionCursor | null = null): Promise<PublicProfileConnectionPage> {
  const { data, error } = await supabase.rpc('get_signal_public_profile_connections_page', {
    p_user_id: userId,
    p_after_connected_at: cursor?.connectedAt ?? null,
    p_after_connection_id: cursor?.connectionId ?? null,
    p_limit: PUBLIC_PROFILE_CONNECTION_PAGE_SIZE + 1,
  })
  if (error) throw new Error(error.message || 'Unable to load connections')
  if (!Array.isArray(data)) throw new Error('Invalid public connections response')
  const rows = (data as Record<string, unknown>[]).slice(0, PUBLIC_PROFILE_CONNECTION_PAGE_SIZE)
  const avatarPaths = rows.map((row) => optionalText(row.avatar_path)).filter((path): path is string => path !== null)
  const avatarUrls = await createProfileAvatarSignedUrls(avatarPaths).catch(() => new Map<string, string>())
  return {
    hasMore: data.length > PUBLIC_PROFILE_CONNECTION_PAGE_SIZE,
    connections: rows.map((row) => {
      const avatarPath = optionalText(row.avatar_path)
      return {
        connectionId: text(row.connection_id, 'connection_id'),
        userId: text(row.user_id, 'user_id'),
        displayName: text(row.display_name, 'display_name'),
        avatarUrl: avatarPath ? avatarUrls.get(avatarPath) ?? null : null,
        connectedAt: text(row.connected_at, 'connected_at'),
      }
    }),
  }
}
