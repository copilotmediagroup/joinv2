import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

const MOMENT_BUCKET = 'signal-moments'
const MAX_MEDIA = 6
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MOMENT_REPORT_TIMEOUT_MS = 12_000
const MOMENT_REPORT_RETRY_DELAY_MS = 250
const MOMENT_REPORT_MAX_ATTEMPTS = 2

export type SignalMomentMedia = {
  storagePath: string
  mediaKind: 'image' | 'video'
  mimeType: string
  url: string
}

export type SignalMoment = {
  momentId: string
  planId: string
  caption: string | null
  publishedAt: string
  authorUserId: string
  authorDisplayName: string
  authorAvatarUrl: string | null
  activityName: string
  cityName: string
  stateCode: string
  participantCount: number
  isLocal: boolean
  media: SignalMomentMedia[]
}

export type SignalMomentReportReason =
  | 'spam'
  | 'harassment'
  | 'hate'
  | 'nudity'
  | 'violence'
  | 'privacy'
  | 'other'

export type SignalMomentEligiblePlan = {
  planId: string
  activityName: string
  cityName: string
  stateCode: string
  scheduledStartsAt: string | null
  completedAt: string | null
}

type MomentMediaRow = {
  storagePath?: unknown
  mediaKind?: unknown
  mimeType?: unknown
}

type MomentRpcRow = {
  moment_id: unknown
  plan_id: unknown
  caption: unknown
  published_at: unknown
  author_user_id: unknown
  author_display_name: unknown
  author_avatar_path: unknown
  activity_name: unknown
  city_name: unknown
  state_code: unknown
  participant_count: unknown
  is_local: unknown
  media: unknown
}

type EligiblePlanRpcRow = {
  plan_id: unknown
  activity_name: unknown
  city_name: unknown
  state_code: unknown
  scheduled_starts_at: unknown
  completed_at: unknown
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid Signal Moment response: ${field}`)
  }
  return value
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requireString(value, 'nullable_string')
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid Signal Moment response: ${field}`)
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Signal Moment response: ${field}`)
  }
  return value
}

function parseMedia(value: unknown): MomentMediaRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid Signal Moment response: media')
  }
  return value as MomentMediaRow[]
}async function signMomentMedia(rows: MomentMediaRow[]): Promise<SignalMomentMedia[]> {
  return Promise.all(rows.map(async (row) => {
    const storagePath = requireString(row.storagePath, 'media.storagePath')
    const mediaKind = requireString(row.mediaKind, 'media.mediaKind')
    const mimeType = requireString(row.mimeType, 'media.mimeType')
    if (mediaKind !== 'image' && mediaKind !== 'video') {
      throw new Error('Invalid Signal Moment response: mediaKind')
    }
    const { data, error } = await supabase.storage
      .from(MOMENT_BUCKET)
      .createSignedUrl(storagePath, 60 * 60)
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'Unable to load Signal Moment media.')
    }
    return { storagePath, mediaKind, mimeType, url: data.signedUrl }
  }))
}

export const SIGNAL_MOMENT_PAGE_SIZE = 20

export type SignalMomentCursor = {
  isLocal: boolean
  publishedAt: string
  momentId: string
}

export async function getSignalMomentsPage(
  cursor: SignalMomentCursor | null = null,
): Promise<SignalMoment[]> {
  const { data, error } = await supabase.rpc('get_signal_moments_page', {
    p_after_is_local: cursor?.isLocal ?? null,
    p_after_published_at: cursor?.publishedAt ?? null,
    p_after_id: cursor?.momentId ?? null,
    p_limit: SIGNAL_MOMENT_PAGE_SIZE,
  })
  if (error) throw new Error(error.message || 'Unable to load Signal Moments.')
  if (!Array.isArray(data)) throw new Error('Invalid Signal Moments response.')

  return Promise.all(data.map(async (raw) => {
    const row = raw as MomentRpcRow
    const avatarPath = nullableString(row.author_avatar_path)
    const authorAvatarUrl = avatarPath
      ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null)
      : null
    return {
      momentId: requireString(row.moment_id, 'moment_id'),
      planId: requireString(row.plan_id, 'plan_id'),
      caption: nullableString(row.caption),
      publishedAt: requireString(row.published_at, 'published_at'),
      authorUserId: requireString(row.author_user_id, 'author_user_id'),
      authorDisplayName: requireString(row.author_display_name, 'author_display_name'),
      authorAvatarUrl,
      activityName: requireString(row.activity_name, 'activity_name'),
      cityName: requireString(row.city_name, 'city_name'),
      stateCode: requireString(row.state_code, 'state_code'),
      participantCount: requireNumber(row.participant_count, 'participant_count'),
      isLocal: requireBoolean(row.is_local, 'is_local'),
      media: await signMomentMedia(parseMedia(row.media)),
    }
  }))
}export async function getMySignalMomentEligiblePlans(): Promise<SignalMomentEligiblePlan[]> {
  const { data, error } = await supabase.rpc('get_my_signal_moment_eligible_plans')
  if (error) throw new Error(error.message || 'Unable to load completed Signals.')
  if (!Array.isArray(data)) throw new Error('Invalid completed Signal response.')

  return data.map((raw) => {
    const row = raw as EligiblePlanRpcRow
    return {
      planId: requireString(row.plan_id, 'plan_id'),
      activityName: requireString(row.activity_name, 'activity_name'),
      cityName: requireString(row.city_name, 'city_name'),
      stateCode: requireString(row.state_code, 'state_code'),
      scheduledStartsAt: nullableString(row.scheduled_starts_at),
      completedAt: nullableString(row.completed_at),
    }
  })
}

function getMediaKind(file: File): 'image' | 'video' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  throw new Error('Signal Moments support photos and videos only.')
}

function makeObjectPath(userId: string, planId: string, file: File): string {
  const extension = file.name.includes('.')
    ? `.${file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')}`
    : ''
  const token = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${userId}/${planId}/${token}${extension}`
}

export function subscribeToSignalMoments(
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel('signal-moments-feed')
    .on(
      'broadcast',
      { event: 'changed' },
      () => onChange(),
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

async function broadcastSignalMomentsChanged(): Promise<void> {
  const channel = supabase.channel(
    `signal-moments-publish-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Signal Moments realtime publish timed out.'))
    }, 5000)

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timeout)
        reject(new Error('Signal Moments realtime publish failed.'))
      }
    })
  })

  try {
    await channel.send({
      type: 'broadcast',
      event: 'changed',
      payload: {},
    })
  } finally {
    await supabase.removeChannel(channel)
  }
}

export async function publishSignalMoment(input: {
  planId: string
  caption: string
  files: File[]
}): Promise<string> {
  if (input.files.length < 1 || input.files.length > MAX_MEDIA) {
    throw new Error(`Choose 1 to ${MAX_MEDIA} photos or videos.`)
  }
  input.files.forEach((file) => {
    getMediaKind(file)
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name} is larger than 100 MB.`)
    }
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('You must be signed in to share a Moment.')

  const uploaded: Array<{
    storagePath: string
    mediaKind: 'image' | 'video'
    mimeType: string
  }> = []

  try {
    for (const file of input.files) {
      const storagePath = makeObjectPath(user.id, input.planId, file)
      const { error } = await supabase.storage
        .from(MOMENT_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        })
      if (error) throw new Error(error.message || 'Moment upload failed.')
      uploaded.push({
        storagePath,
        mediaKind: getMediaKind(file),
        mimeType: file.type,
      })
    }

    const { data, error } = await supabase.rpc('publish_my_signal_moment', {
      p_plan_id: input.planId,
      p_caption: input.caption,
      p_media: uploaded.map((item) => ({
        storagePath: item.storagePath,
        mediaKind: item.mediaKind,
        mimeType: item.mimeType,
      })),
    })
    if (error) throw new Error(error.message || 'Unable to publish Signal Moment.')
    const momentId = requireString(data, 'moment_id')

    void broadcastSignalMomentsChanged().catch(() => undefined)

    return momentId
  } catch (error) {
    if (uploaded.length > 0) {
      await supabase.storage
        .from(MOMENT_BUCKET)
        .remove(uploaded.map((item) => item.storagePath))
        .catch(() => undefined)
    }
    throw error
  }
}

export async function reportSignalMoment(input: {
  momentId: string
  reason: SignalMomentReportReason
  details?: string
}): Promise<string> {
  let lastMessage = 'Unable to report this Signal Moment.'

  for (let attempt = 0; attempt < MOMENT_REPORT_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), MOMENT_REPORT_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('report_signal_moment', {
          p_moment_id: input.momentId,
          p_reason: input.reason,
          p_details: input.details?.trim() || null,
        })
        .abortSignal(controller.signal)

      if (!error) return requireString(data, 'report_id')
      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= MOMENT_REPORT_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, MOMENT_REPORT_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}

export async function deleteMySignalMoment(momentId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_my_signal_moment', {
    p_moment_id: momentId,
  })

  if (error) {
    throw new Error(error.message || 'Unable to delete this Signal Moment.')
  }

  const paths = Array.isArray(data)
    ? data.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(MOMENT_BUCKET)
      .remove(paths)

    if (storageError) {
      throw new Error(storageError.message || 'Moment was removed, but media cleanup failed.')
    }
  }

  void broadcastSignalMomentsChanged().catch(() => undefined)
}
