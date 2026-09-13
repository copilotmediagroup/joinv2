import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

export type SignalConnectionPerson = {
  connectionId: string | null
  userId: string
  displayName: string
  avatarUrl: string | null
  state: 'none' | 'pending' | 'connected' | 'declined'
  direction: 'none' | 'incoming' | 'outgoing'
}

type ConnectionRow = {
  connection_id: unknown
  other_user_id: unknown
  display_name: unknown
  avatar_path: unknown
  connection_state: unknown
  request_direction: unknown
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid connection response: ${field}`)
  return value
}

export async function getCompletedPlanConnections(planId: string): Promise<SignalConnectionPerson[]> {
  const { data, error } = await supabase.rpc('get_my_completed_plan_connections', { p_plan_id: planId })
  if (error) throw new Error(error.message || 'Unable to load connections')
  if (!Array.isArray(data)) throw new Error('Invalid connection response')

  return Promise.all((data as ConnectionRow[]).map(async (row) => {
    const avatarPath = typeof row.avatar_path === 'string' && row.avatar_path.trim() ? row.avatar_path : null
    const state = requireString(row.connection_state, 'connection_state') as SignalConnectionPerson['state']
    const direction = requireString(row.request_direction, 'request_direction') as SignalConnectionPerson['direction']
    return {
      connectionId: typeof row.connection_id === 'string' ? row.connection_id : null,
      userId: requireString(row.other_user_id, 'other_user_id'),
      displayName: requireString(row.display_name, 'display_name'),
      avatarUrl: avatarPath ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null) : null,
      state,
      direction,
    }
  }))
}

export async function requestSignalConnection(planId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc('request_signal_connection', {
    p_plan_id: planId,
    p_target_user_id: targetUserId,
  })
  if (error) throw new Error(error.message || 'Unable to send connection request')
}

export async function respondToSignalConnection(connectionId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_to_signal_connection', {
    p_connection_id: connectionId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message || 'Unable to update connection')
}
