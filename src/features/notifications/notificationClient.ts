import { supabase } from '../../lib/supabaseClient'

export type SignalNotification = {
  id: string
  type: string
  title: string
  body: string | null
  state: 'unread' | 'read'
  relatedPlanId: string | null
  relatedSignalGroupId: string | null
  relatedEntityId: string | null
  createdAt: string
  readAt: string | null
}

type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  state: SignalNotification['state']
  related_plan_id: string | null
  related_signal_group_id: string | null
  related_entity_id: string | null
  created_at: string
  read_at: string | null
}

function mapRow(row: NotificationRow): SignalNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    state: row.state,
    relatedPlanId: row.related_plan_id,
    relatedSignalGroupId: row.related_signal_group_id,
    relatedEntityId: row.related_entity_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

export async function getMyNotifications(limit = 30): Promise<SignalNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,title,body,state,related_plan_id,related_signal_group_id,related_entity_id,created_at,read_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message || 'Unable to load notifications')
  return (data ?? []).map((row) => mapRow(row as NotificationRow))
}


export type NotificationTarget =
  | {
      targetType: 'plan'
      planId: string
      relatedEntityId: string | null
    }
  | {
      targetType: 'signal'
      signalGroupId: string
      signalIntentId: string
      groupState: string
      activitySlug: string
      relatedEntityId: string | null
    }
  | {
      targetType: 'none'
      relatedEntityId: string | null
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export async function resolveMyNotificationTarget(
  notificationId: string,
): Promise<NotificationTarget> {
  const { data, error } = await supabase.rpc(
    'resolve_my_notification_target',
    { p_notification_id: notificationId },
  )

  if (error) throw new Error(error.message || 'Unable to open notification')
  if (!isRecord(data) || typeof data.targetType !== 'string') {
    throw new Error('Invalid notification target response')
  }

  const relatedEntityId = nullableString(data.relatedEntityId)

  if (data.targetType === 'plan' && typeof data.planId === 'string') {
    return { targetType: 'plan', planId: data.planId, relatedEntityId }
  }

  if (
    data.targetType === 'signal' &&
    typeof data.signalGroupId === 'string' &&
    typeof data.signalIntentId === 'string' &&
    typeof data.groupState === 'string' &&
    typeof data.activitySlug === 'string'
  ) {
    return {
      targetType: 'signal',
      signalGroupId: data.signalGroupId,
      signalIntentId: data.signalIntentId,
      groupState: data.groupState,
      activitySlug: data.activitySlug,
      relatedEntityId,
    }
  }

  return { targetType: 'none', relatedEntityId }
}

export async function markMyNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_my_notification_read', {
    p_notification_id: notificationId,
  })
  if (error) throw new Error(error.message || 'Unable to mark notification read')
}

export function subscribeToMyNotifications(userId: string, onInvalidate: () => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, onInvalidate)
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
