import { supabase } from '../../../lib/supabaseClient'
import { createProfileAvatarSignedUrls } from '../../onboarding/avatarClient'

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

function mapDiscoveryRow(
  row: SignalDiscoveryRpcRow,
  avatarUrlByPath: Map<string, string>,
): SignalDiscoveryActivity {
  const avatarPaths = normalizeAvatarPaths(row.preview_avatar_paths)
  return {
    activityId: row.activity_id,
    activitySlug: row.activity_slug,
    activityName: row.activity_name,
    activeCount:
      Number.isFinite(row.active_count) && row.active_count >= 0
        ? row.active_count
        : 0,
    previewAvatarUrls: avatarPaths
      .map((path) => avatarUrlByPath.get(path))
      .filter((url): url is string => Boolean(url)),
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

  const rows = data as SignalDiscoveryRpcRow[]
  const avatarPaths = [...new Set(rows.flatMap((row) => normalizeAvatarPaths(row.preview_avatar_paths)))]
  let avatarUrlByPath = new Map<string, string>()
  if (avatarPaths.length) {
    try {
      avatarUrlByPath = await createProfileAvatarSignedUrls(avatarPaths, AVATAR_SIGNED_URL_SECONDS)
    } catch {
      avatarUrlByPath = new Map()
    }
  }
  return rows.map((row) => mapDiscoveryRow(row, avatarUrlByPath))
}

export async function subscribeToSignalDiscovery(
  onRefresh: () => void,
  onDisconnected?: () => void,
): Promise<() => void> {
  const { data, error } =
    await supabase.rpc('get_my_signal_discovery_realtime_topic')

  if (error) {
    throw error
  }

  if (typeof data !== 'string' || !data.startsWith('signal-discovery:')) {
    throw new Error('Signal discovery realtime topic is unavailable.')
  }

  await supabase.realtime.setAuth()

  const channel = supabase
    .channel(data, { config: { private: true } })
    .on('broadcast', { event: 'refresh' }, () => onRefresh())

  let subscribed = false

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true
        resolve()
        return
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (subscribed) {
          onDisconnected?.()
          return
        }
        reject(error ?? new Error(`Signal discovery realtime subscription failed: ${status}`))
      }
    })
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}
