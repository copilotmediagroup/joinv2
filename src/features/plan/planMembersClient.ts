import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrls } from '../onboarding/avatarClient'

export type PlanMemberIdentity = {
  userId: string
  displayName: string
  avatarPath: string | null
  avatarUrl: string | null
  joinedAt: string
  isMe: boolean
}

type PlanMemberRow = {
  user_id: unknown
  display_name: unknown
  avatar_path: unknown
  joined_at: unknown
  is_me: unknown
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid Plan member response: ${field}`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : null
}

function mapPlanMember(row: PlanMemberRow, avatarUrls: Map<string, string>): PlanMemberIdentity {
  const avatarPath = optionalString(row.avatar_path)

  return {
    userId: requireString(row.user_id, 'user id'),
    displayName: requireString(row.display_name, 'display name'),
    avatarPath,
    avatarUrl: avatarPath ? avatarUrls.get(avatarPath) ?? null : null,
    joinedAt: requireString(row.joined_at, 'joined at'),
    isMe: row.is_me === true,
  }
}

export async function getMyPlanMembers(
  planId: string,
): Promise<PlanMemberIdentity[]> {
  if (!planId.trim()) {
    throw new Error('A Plan is required to load members.')
  }

  const { data, error } = await supabase.rpc('get_my_plan_members', {
    p_plan_id: planId,
  })

  if (error) {
    const message = error.message || ''
    if (message.includes('plan_membership_required')) {
      throw new Error('You’re no longer part of this Plan.')
    }
    throw new Error('We couldn’t refresh the people in this Plan right now.')
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid Plan member response.')
  }

  const rows = data as PlanMemberRow[]
  const avatarPaths = [...new Set(rows.map((row) => optionalString(row.avatar_path)).filter((path): path is string => Boolean(path)))]
  let avatarUrls = new Map<string, string>()
  if (avatarPaths.length) {
    try {
      avatarUrls = await createProfileAvatarSignedUrls(avatarPaths)
    } catch {
      avatarUrls = new Map()
    }
  }
  return rows.map((row) => mapPlanMember(row, avatarUrls))
}

export function subscribeToPlanMembers(
  planId: string,
  onChange: () => void,
): () => void {
  let cancelled = false
  let channel: ReturnType<typeof supabase.channel> | null = null

  void supabase.realtime.setAuth().then(() => {
    if (cancelled) return
    channel = supabase
      .channel(`plan-members:${planId}`, { config: { private: true } })
      .on('broadcast', { event: 'refresh' }, onChange)
      .subscribe()
  })

  return () => {
    cancelled = true
    if (channel) void supabase.removeChannel(channel)
  }
}
