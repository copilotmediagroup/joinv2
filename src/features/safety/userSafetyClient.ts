import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

export type UserReportReason =
  | 'harassment' | 'threats' | 'hate' | 'sexual'
  | 'spam' | 'impersonation' | 'privacy' | 'other'

export type BlockedUser = {
  blockId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  blockedAt: string
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid safety response: ${field}`)
  }
  return value
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target_user_id: userId })
  if (error) throw new Error(error.message || 'Unable to block this person')
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_target_user_id: userId })
  if (error) throw new Error(error.message || 'Unable to unblock this person')
}
export async function reportUser(
  userId: string,
  reason: UserReportReason,
  details: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('report_user', {
    p_target_user_id: userId,
    p_reason: reason,
    p_details: details,
  })
  if (error) throw new Error(error.message || 'Unable to report this person')
  return required(data, 'report id')
}

export const BLOCKED_USERS_PAGE_SIZE = 30

type BlockedUsersCursor = {
  blockedAt: string
  blockId: string
}

export async function getMyBlockedUsersPage(
  cursor: BlockedUsersCursor | null = null,
): Promise<BlockedUser[]> {
  const { data, error } = await supabase.rpc('get_my_blocked_users_page', {
    p_after_blocked_at: cursor?.blockedAt ?? null,
    p_after_block_id: cursor?.blockId ?? null,
    p_limit: BLOCKED_USERS_PAGE_SIZE,
  })
  if (error) throw new Error(error.message || 'Unable to load blocked people')
  if (!Array.isArray(data)) throw new Error('Invalid blocked users response')

  return Promise.all(data.map(async (raw) => {
    const row = raw as Record<string, unknown>
    const avatarPath = typeof row.avatar_path === 'string' && row.avatar_path.trim()
      ? row.avatar_path
      : null
    return {
      blockId: required(row.block_id, 'block id'),
      userId: required(row.user_id, 'user id'),
      displayName: required(row.display_name, 'display name'),
      avatarUrl: avatarPath
        ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null)
        : null,
      blockedAt: required(row.blocked_at, 'blocked at'),
    }
  }))
}
