import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

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

async function mapPlanMember(row: PlanMemberRow): Promise<PlanMemberIdentity> {
  const avatarPath = optionalString(row.avatar_path)
  let avatarUrl: string | null = null

  if (avatarPath) {
    try {
      avatarUrl = await createProfileAvatarSignedUrl(avatarPath)
    } catch {
      avatarUrl = null
    }
  }

  return {
    userId: requireString(row.user_id, 'user id'),
    displayName: requireString(row.display_name, 'display name'),
    avatarPath,
    avatarUrl,
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
    throw new Error(error.message || 'Unable to load Plan members.')
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid Plan member response.')
  }

  return Promise.all(
    data.map((row) => mapPlanMember(row as PlanMemberRow)),
  )
}

export function subscribeToPlanMembers(
  planId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`plan-members:${planId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'plan_memberships',
        filter: `plan_id=eq.${planId}`,
      },
      onChange,
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
