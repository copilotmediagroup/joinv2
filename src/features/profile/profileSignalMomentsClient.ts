import { supabase } from '../../lib/supabaseClient'

const MOMENT_BUCKET = 'signal-moments'
export const PROFILE_SIGNAL_MOMENT_PAGE_SIZE = 12

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

export type ProfileSignalMomentCursor = { publishedAt: string; momentId: string }
export type ProfileSignalMomentPage = { moments: ProfileSignalMoment[]; hasMore: boolean }

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid profile Signal Moment: ${field}`)
  return value
}

async function mapMomentRows(rows: Record<string, unknown>[]): Promise<ProfileSignalMoment[]> {
  const descriptors = rows.map((row) => ({
    row,
    media: (Array.isArray(row.media) ? row.media : []).map((item) => {
      const raw = item as Record<string, unknown>
      const storagePath = string(raw.storagePath, 'media.storagePath')
      const mediaKind = string(raw.mediaKind, 'media.mediaKind')
      if (mediaKind !== 'image' && mediaKind !== 'video') throw new Error('Invalid profile Signal media kind.')
      return { storagePath, mediaKind: mediaKind as 'image' | 'video', mimeType: string(raw.mimeType, 'media.mimeType') }
    }),
  }))
  const paths = descriptors.flatMap(({ media }) => media.map((item) => item.storagePath))
  const signedByPath = new Map<string, string>()
  if (paths.length) {
    const { data: signed, error } = await supabase.storage.from(MOMENT_BUCKET).createSignedUrls(paths, 3600)
    if (error || !signed || signed.length !== paths.length) throw new Error(error?.message || 'Unable to load Signal media.')
    signed.forEach((item, index) => {
      if (!item.signedUrl) throw new Error(item.error || 'Unable to load Signal media.')
      signedByPath.set(paths[index], item.signedUrl)
    })
  }

  return descriptors.map(({ row, media }) => ({
    momentId: string(row.moment_id, 'moment_id'),
    planId: string(row.plan_id, 'plan_id'),
    caption: row.caption === null ? null : string(row.caption, 'caption'),
    publishedAt: string(row.published_at, 'published_at'),
    activityName: string(row.activity_name, 'activity_name'),
    cityName: string(row.city_name, 'city_name'),
    stateCode: string(row.state_code, 'state_code'),
    venueName: row.venue_name === null ? null : string(row.venue_name, 'venue_name'),
    signalCount: Number(row.signal_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    media: media.map((item) => ({ ...item, url: signedByPath.get(item.storagePath) ?? '' })),
  }))
}

export async function getMyProfileSignalMoments(cursor: ProfileSignalMomentCursor | null = null): Promise<ProfileSignalMomentPage> {
  const { data, error } = await supabase.rpc('get_my_profile_signal_moments_page', {
    p_after_published_at: cursor?.publishedAt ?? null,
    p_after_id: cursor?.momentId ?? null,
    p_limit: PROFILE_SIGNAL_MOMENT_PAGE_SIZE + 1,
  })
  if (error) throw new Error(error.message || 'Unable to load your Signal Life.')
  if (!Array.isArray(data)) throw new Error('Invalid profile Signal Moment response.')
  const rows = (data as Record<string, unknown>[]).slice(0, PROFILE_SIGNAL_MOMENT_PAGE_SIZE)
  return { moments: await mapMomentRows(rows), hasMore: data.length > PROFILE_SIGNAL_MOMENT_PAGE_SIZE }
}
