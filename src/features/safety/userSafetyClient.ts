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

const SAFETY_MUTATION_TIMEOUT_MS = 12_000
const SAFETY_MUTATION_RETRY_DELAY_MS = 250
const SAFETY_MUTATION_MAX_ATTEMPTS = 2

async function runRetrySafeSafetyMutation(
  rpcName: 'block_user' | 'unblock_user',
  userId: string,
  fallbackMessage: string,
): Promise<void> {
  let lastMessage = fallbackMessage

  for (let attempt = 0; attempt < SAFETY_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), SAFETY_MUTATION_TIMEOUT_MS)

    try {
      const { error, status } = await supabase
        .rpc(rpcName, { p_target_user_id: userId })
        .abortSignal(controller.signal)

      if (!error) return
      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= SAFETY_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, SAFETY_MUTATION_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}

export function blockUser(userId: string): Promise<void> {
  return runRetrySafeSafetyMutation('block_user', userId, 'Unable to block this person')
}

export function unblockUser(userId: string): Promise<void> {
  return runRetrySafeSafetyMutation('unblock_user', userId, 'Unable to unblock this person')
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
