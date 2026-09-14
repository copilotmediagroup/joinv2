import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'
import { createProfileAvatarSignedUrl } from '../onboarding/avatarClient'

export type DirectThread = {
  conversationId: string
  connectionId: string
  otherUserId: string
  displayName: string
  avatarUrl: string | null
  lastMessageBody: string | null
  lastMessageAt: string | null
  unreadCount: number
  sortAt: string
}

export type DirectMessage = {
  messageId: string
  conversationId: string
  senderUserId: string
  body: string
  sentAt: string
  readAt: string | null
}

function req(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid direct messaging response: ${field}`)
  return value
}
function nullable(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null }

export const DIRECT_THREAD_PAGE_SIZE = 30

type DirectThreadCursor = {
  sortAt: string
  conversationId: string
}

async function parseDirectThread(row: Record<string, unknown>): Promise<DirectThread> {
  const avatarPath = nullable(row.avatar_path)
  return {
    conversationId: req(row.conversation_id, 'conversation_id'),
    connectionId: req(row.connection_id, 'connection_id'),
    otherUserId: req(row.other_user_id, 'other_user_id'),
    displayName: req(row.display_name, 'display_name'),
    avatarUrl: avatarPath ? await createProfileAvatarSignedUrl(avatarPath).catch(() => null) : null,
    lastMessageBody: nullable(row.last_message_body),
    lastMessageAt: nullable(row.last_message_at),
    unreadCount: typeof row.unread_count === 'number' ? row.unread_count : 0,
    sortAt: req(row.sort_at, 'sort_at'),
  }
}

export async function getMyDirectThreadsPage(
  cursor: DirectThreadCursor | null = null,
): Promise<DirectThread[]> {
  const { data, error } = await supabase.rpc('get_my_direct_threads_page', {
    p_after_sort_at: cursor?.sortAt ?? null,
    p_after_conversation_id: cursor?.conversationId ?? null,
    p_limit: DIRECT_THREAD_PAGE_SIZE,
  })
  if (error) throw new Error(error.message || 'Unable to load direct messages')
  if (!Array.isArray(data)) throw new Error('Invalid direct threads response')
  return Promise.all((data as Record<string, unknown>[]).map(parseDirectThread))
}

export async function getMyDirectThread(conversationId: string): Promise<DirectThread | null> {
  const { data, error } = await supabase.rpc('get_my_direct_thread', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message || 'Unable to load direct conversation')
  const row = Array.isArray(data) ? data[0] : null
  return row ? parseDirectThread(row as Record<string, unknown>) : null
}

export async function getOrCreateDirectConversation(connectionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_my_direct_conversation', { p_connection_id: connectionId })
  if (error) throw new Error(error.message || 'Unable to open direct message')
  return req(data, 'conversation_id')
}

export async function getMyDirectMessages(conversationId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase.rpc('get_my_direct_messages', { p_conversation_id: conversationId, p_limit: 100 })
  if (error) throw new Error(error.message || 'Unable to load direct messages')
  if (!Array.isArray(data)) throw new Error('Invalid direct messages response')
  return (data as Record<string, unknown>[]).map((row) => ({
    messageId: req(row.message_id, 'message_id'), conversationId,
    senderUserId: req(row.sender_user_id, 'sender_user_id'), body: req(row.body, 'body'),
    sentAt: req(row.sent_at, 'sent_at'), readAt: nullable(row.read_at),
  }))
}

export async function sendMyDirectMessage(conversationId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('send_my_direct_message', { p_conversation_id: conversationId, p_body: body })
  if (error) throw new Error(error.message || 'Unable to send direct message')
}

export async function markMyDirectConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_my_direct_conversation_read', { p_conversation_id: conversationId })
  if (error) throw new Error(error.message || 'Unable to mark direct messages read')
}

export function subscribeToDirectMessages(conversationId: string, onChange: () => void): () => void {
  let channel: RealtimeChannel | null = null
  let stopped = false
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleRefresh = () => {
    if (stopped || refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      if (!stopped) onChange()
    }, 40)
  }

  channel = supabase.channel(`direct-messages:${conversationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, scheduleRefresh)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_conversations', filter: `id=eq.${conversationId}` }, scheduleRefresh)
    .subscribe()

  return () => {
    stopped = true
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    if (channel) { void supabase.removeChannel(channel); channel = null }
  }
}
