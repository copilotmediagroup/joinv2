import { supabase } from '../../lib/supabaseClient'

const MOMENT_BUCKET = 'signal-moments'

export type ProfileSignalMedia = {
  storagePath: string
  mediaKind: 'image' | 'video'
  mimeType: string
  url: string
}

export type ProfileSignalMoment = {
  momentId: string
  planId: string
  caption: string | null
  publishedAt: string
  activityName: string
  cityName: string
  stateCode: string
  venueName: string | null
  signalCount: number
  commentCount: number
  media: ProfileSignalMedia[]
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid profile Signal Moment: ${field}`)
  return value
}

export async function getMyProfileSignalMoments(): Promise<ProfileSignalMoment[]> {
  const { data, error } = await supabase.rpc('get_my_profile_signal_moments', { p_limit: 60 })
  if (error) throw new Error(error.message || 'Unable to load your Signal Life.')
  if (!Array.isArray(data)) throw new Error('Invalid profile Signal Moment response.')

  return Promise.all(data.map(async (raw) => {
    const row = raw as Record<string, unknown>
    const rawMedia = Array.isArray(row.media) ? row.media as Record<string, unknown>[] : []
    const media = await Promise.all(rawMedia.map(async (item) => {
      const storagePath = string(item.storagePath, 'media.storagePath')
      const mediaKind = string(item.mediaKind, 'media.mediaKind')
      if (mediaKind !== 'image' && mediaKind !== 'video') throw new Error('Invalid profile Signal media kind.')
      const mimeType = string(item.mimeType, 'media.mimeType')
      const { data: signed, error: signedError } = await supabase.storage.from(MOMENT_BUCKET).createSignedUrl(storagePath, 3600)
      if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || 'Unable to load Signal media.')
      return { storagePath, mediaKind: mediaKind as 'image' | 'video', mimeType, url: signed.signedUrl }
    }))
    return {
      momentId: string(row.moment_id, 'moment_id'), planId: string(row.plan_id, 'plan_id'),
      caption: row.caption === null ? null : string(row.caption, 'caption'),
      publishedAt: string(row.published_at, 'published_at'), activityName: string(row.activity_name, 'activity_name'),
      cityName: string(row.city_name, 'city_name'), stateCode: string(row.state_code, 'state_code'),
      venueName: row.venue_name === null ? null : string(row.venue_name, 'venue_name'),
      signalCount: Number(row.signal_count) || 0, commentCount: Number(row.comment_count) || 0, media,
    }
  }))
}
