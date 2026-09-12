import { supabase } from '../../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../../onboarding/avatarClient'

export type SignalParticipantIdentity = {
  userId: string
  displayName: string
  avatarUrl: string | null
  membershipState: 'matched' | 'confirmed'
  matchedAt: string
  isMe: boolean
}

type SignalParticipantRow = {
  user_id: string
  display_name: string
  avatar_path: string | null
  membership_state: SignalParticipantIdentity['membershipState']
  matched_at: string
  is_me: boolean
}

export async function getMySignalParticipants(
  signalGroupId: string,
): Promise<SignalParticipantIdentity[]> {
  const { data, error } = await supabase.rpc(
    'get_my_signal_participants',
    { p_signal_group_id: signalGroupId },
  )
  if (error) {
    throw new Error(error.message || 'Unable to load Signal participants')
  }

  const rows = (data ?? []) as SignalParticipantRow[]

  return Promise.all(rows.map(async (row) => {
    let avatarUrl: string | null = null

    if (row.avatar_path) {
      try {
        avatarUrl = await createProfileAvatarSignedUrl(row.avatar_path)
      } catch {
        avatarUrl = null
      }
    }

    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl,
      membershipState: row.membership_state,
      matchedAt: row.matched_at,
      isMe: row.is_me,
    }
  }))
}
