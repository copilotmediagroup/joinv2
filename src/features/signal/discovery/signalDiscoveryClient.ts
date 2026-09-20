import { supabase } from '../../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../../onboarding/avatarClient'

export type SignalDiscoveryActivity = {
  activityId: string
  activitySlug: string
  activityName: string
  activeCount: number
  previewAvatarUrls: string[]
}

type SignalDiscoveryRpcRow = {
  activity_id: string
  activity_slug: string
  activity_name: string
  active_count: number
  preview_avatar_paths: string[] | null
}

const AVATAR_SIGNED_URL_SECONDS = 3600

function normalizeAvatarPaths(
  value: string[] | null | undefined,
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const valueItem of value) {
    if (typeof valueItem !== 'string') {
      continue
    }

    const path = valueItem.trim()

    if (!path || seen.has(path)) {
      continue
    }

    seen.add(path)
    result.push(path)

    if (result.length === 4) {
      break
    }
  }

  return result
}

async function resolveAvatarUrls(
  avatarPaths: string[],
): Promise<string[]> {
  const results = await Promise.allSettled(
    avatarPaths.map((avatarPath) =>
      createProfileAvatarSignedUrl(
        avatarPath,
        AVATAR_SIGNED_URL_SECONDS,
      ),
    ),
  )

  const urls: string[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      urls.push(result.value)
    }
  }

  return urls
}

async function mapDiscoveryRow(
  row: SignalDiscoveryRpcRow,
): Promise<SignalDiscoveryActivity> {
  const avatarPaths =
    normalizeAvatarPaths(row.preview_avatar_paths)

  const previewAvatarUrls =
    await resolveAvatarUrls(avatarPaths)

  return {
    activityId: row.activity_id,
    activitySlug: row.activity_slug,
    activityName: row.activity_name,
    activeCount:
      Number.isFinite(row.active_count) &&
      row.active_count >= 0
        ? row.active_count
        : 0,
    previewAvatarUrls,
  }
}

export async function getMySignalDiscovery():
Promise<SignalDiscoveryActivity[]> {
  const { data, error } =
    await supabase.rpc('get_my_signal_discovery')

  if (error) {
    throw error
  }

  if (!Array.isArray(data)) {
    return []
  }

  return Promise.all(
    (data as SignalDiscoveryRpcRow[]).map(
      mapDiscoveryRow,
    ),
  )
}

export async function subscribeToSignalDiscovery(
  onRefresh: () => void,
): Promise<() => void> {
  const { data, error } =
    await supabase.rpc('get_my_signal_discovery_realtime_topic')

  if (error) {
    throw error
  }

  if (typeof data !== 'string' || !data.startsWith('signal-discovery:')) {
    throw new Error('Signal discovery realtime topic is unavailable.')
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    throw sessionError
  }

  if (!session?.access_token) {
    throw new Error('Signal discovery realtime authentication is unavailable.')
  }

  await supabase.realtime.setAuth(session.access_token)

  const channel = supabase
    .channel(data, { config: { private: true } })
    .on('broadcast', { event: 'refresh' }, () => onRefresh())

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        resolve()
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reject(error ?? new Error(`Signal discovery realtime subscription failed: ${status}`))
      }
    })
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}
