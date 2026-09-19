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

export async function getOrCreateDirectConversationWithUser(otherUserId: string): Promise<string> {
  let lastMessage = 'Unable to open direct message'
  for (let attempt = 0; attempt < DIRECT_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), DIRECT_SEND_TIMEOUT_MS)
    try {
      const { data, error, status } = await supabase
        .rpc('get_or_create_my_direct_conversation_with_user', { p_other_user_id: otherUserId })
        .abortSignal(controller.signal)
      if (!error) return req(data, 'conversation_id')
      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= DIRECT_SEND_MAX_ATTEMPTS) break
    } finally { window.clearTimeout(timeoutId) }
    await new Promise((resolve) => window.setTimeout(resolve, DIRECT_SEND_RETRY_DELAY_MS))
  }
  throw new Error(lastMessage)
}

export async function getOrCreateDirectConversation(connectionId: string): Promise<string> {
  let lastMessage = 'Unable to open direct message'

  for (let attempt = 0; attempt < DIRECT_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), DIRECT_SEND_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('get_or_create_my_direct_conversation', { p_connection_id: connectionId })
        .abortSignal(controller.signal)
      if (!error) return req(data, 'conversation_id')
      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= DIRECT_SEND_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, DIRECT_SEND_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
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

const DIRECT_SEND_TIMEOUT_MS = 12_000
const DIRECT_SEND_RETRY_DELAY_MS = 250
const DIRECT_SEND_MAX_ATTEMPTS = 2

export async function sendMyDirectMessage(conversationId: string, body: string): Promise<void> {
  const clientMessageId = crypto.randomUUID()
  let lastMessage = 'Unable to send direct message'

  for (let attempt = 0; attempt < DIRECT_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), DIRECT_SEND_TIMEOUT_MS)

    try {
      const { error, status } = await supabase
        .rpc('send_my_direct_message_v2', {
          p_conversation_id: conversationId,
          p_body: body,
          p_client_message_id: clientMessageId,
        })
        .abortSignal(controller.signal)

      if (!error) return
      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= DIRECT_SEND_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, DIRECT_SEND_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}

export async function markMyDirectConversationRead(conversationId: string): Promise<void> {
  let lastMessage = 'Unable to mark direct messages read'

  for (let attempt = 0; attempt < DIRECT_SEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), DIRECT_SEND_TIMEOUT_MS)

    try {
      const { error, status } = await supabase
        .rpc('mark_my_direct_conversation_read', { p_conversation_id: conversationId })
        .abortSignal(controller.signal)
      if (!error) return
      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= DIRECT_SEND_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, DIRECT_SEND_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
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

export type DirectTypingSubscription = {
  setTyping: (typing: boolean) => void
  stop: () => void
}

export function subscribeToDirectTyping(
  conversationId: string,
  currentUserId: string,
  onOtherUserTyping: (typing: boolean) => void,
): DirectTypingSubscription {
  let stopped = false
  let subscribed = false
  let pendingTyping = false
  let lastSentTyping: boolean | null = null
  let stopTimer: ReturnType<typeof setTimeout> | null = null

  const channel = supabase.channel(`direct-typing:${conversationId}`)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (stopped || !payload || payload.userId === currentUserId) return
      if (typeof payload.typing === 'boolean') onOtherUserTyping(payload.typing)
    })
    .subscribe((status) => {
      subscribed = status === 'SUBSCRIBED'
      if (subscribed && pendingTyping !== lastSentTyping) {
        lastSentTyping = pendingTyping
        void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing: pendingTyping } })
      }
    })

  const publish = (typing: boolean) => {
    pendingTyping = typing
    if (!subscribed || stopped || lastSentTyping === typing) return
    lastSentTyping = typing
    void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing } })
  }

  return {
    setTyping: (typing) => {
      if (stopped) return
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
      publish(typing)
      if (typing) stopTimer = setTimeout(() => publish(false), 2200)
    },
    stop: () => {
      if (stopped) return
      if (stopTimer) clearTimeout(stopTimer)
      stopTimer = null
      if (subscribed && pendingTyping) {
        void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing: false } })
      }
      stopped = true
      void supabase.removeChannel(channel)
    },
  }
}
