import type {
  RealtimeChannel,
} from '@supabase/supabase-js'

import { supabase } from '../../lib/supabaseClient'
import {
  getPlanMessages,
  type PlanMessage,
} from './messagingClient'

export type MessagingRealtimeConnectionState =
  | 'connecting'
  | 'subscribed'
  | 'channel_error'
  | 'timed_out'
  | 'closed'

export type MessagingRealtimeListener = {
  onMessages: (
    messages: PlanMessage[],
  ) => void
  onError?: (
    error: Error,
  ) => void
  onConnectionStateChange?: (
    state: MessagingRealtimeConnectionState,
  ) => void
}

export type MessagingRealtimeSubscription = {
  refresh: () => Promise<void>
  stop: () => Promise<void>
}

function asError(
  value: unknown,
  fallback: string,
): Error {
  if (value instanceof Error) {
    return value
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    'message' in value &&
    typeof (
      value as {
        message?: unknown
      }
    ).message === 'string'
  ) {
    return new Error(
      (
        value as {
          message: string
        }
      ).message,
    )
  }

  return new Error(fallback)
}

function normalizeConnectionState(
  status: string,
): MessagingRealtimeConnectionState | null {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed'

    case 'CHANNEL_ERROR':
      return 'channel_error'

    case 'TIMED_OUT':
      return 'timed_out'

    case 'CLOSED':
      return 'closed'

    default:
      return null
  }
}

/**
 * Observe one authorized Plan conversation.
 *
 * Realtime is an invalidation mechanism only.
 * Realtime payloads never become message-history truth
 * directly.
 *
 * Every message INSERT causes a fresh RLS-protected
 * read through getPlanMessages().
 *
 * Reaching SUBSCRIBED also refreshes history. This
 * closes the race between the initial read and
 * subscription establishment and resynchronizes after
 * channel reconnection.
 */
export function subscribeToPlanMessagesRealtime(
  conversationId: string,
  listener: MessagingRealtimeListener,
): MessagingRealtimeSubscription {
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0
  ) {
    throw new Error(
      'A conversation is required for messaging Realtime.',
    )
  }

  const normalizedConversationId =
    conversationId.trim()

  let stopped = false
  let channel: RealtimeChannel | null = null
  let refreshRunning = false
  let refreshQueued = false

  const emitConnectionState = (
    state: MessagingRealtimeConnectionState,
  ) => {
    if (stopped) return

    listener.onConnectionStateChange?.(
      state,
    )
  }

  const runRefresh = async () => {
    if (stopped) return

    if (refreshRunning) {
      refreshQueued = true
      return
    }

    refreshRunning = true

    try {
      do {
        refreshQueued = false

        const messages =
          await getPlanMessages(
            normalizedConversationId,
          )

        if (!stopped) {
          listener.onMessages(messages)
        }
      } while (
        !stopped &&
        refreshQueued
      )
    } catch (error) {
      if (!stopped) {
        listener.onError?.(
          asError(
            error,
            'Unable to refresh messages.',
          ),
        )
      }
    } finally {
      refreshRunning = false
    }
  }

  const refresh = async () => {
    await runRefresh()
  }

  emitConnectionState('connecting')

  void supabase.realtime.setAuth().then(() => {
    if (stopped) return
    channel = supabase
      .channel(
        `messages:${normalizedConversationId}`,
        { config: { private: true } },
      )
      .on(
        'broadcast',
        { event: 'refresh' },
        () => {
          void runRefresh()
        },
      )
      .subscribe((status) => {
        const normalized =
          normalizeConnectionState(status)

        if (normalized) {
          emitConnectionState(normalized)
        }

        if (status === 'SUBSCRIBED') {
          void runRefresh()
        }
      })
  })

  /*
   * Initial authoritative read starts immediately.
   *
   * SUBSCRIBED causes another read so a message
   * committed between this request and subscription
   * establishment cannot leave the client stale.
   */
  void runRefresh()

  return {
    refresh,

    async stop() {
      if (stopped) return

      stopped = true

      const activeChannel = channel
      channel = null

      if (activeChannel) {
        await supabase.removeChannel(
          activeChannel,
        )
      }
    },
  }
}

export type PlanTypingSubscription = {
  setTyping: (typing: boolean) => void
  stop: () => void
}

export function subscribeToPlanTyping(
  conversationId: string,
  currentUserId: string,
  onMemberTyping: (userId: string, typing: boolean) => void,
): PlanTypingSubscription {
  let stopped = false
  let subscribed = false
  let pendingTyping = false
  let lastSentTyping: boolean | null = null
  let stopTimer: ReturnType<typeof setTimeout> | null = null
  let channel: RealtimeChannel | null = null

  void supabase.realtime.setAuth().then(() => {
    if (stopped) return
    channel = supabase
      .channel(`plan-typing:${conversationId}`, { config: { private: true } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (stopped || !payload || payload.userId === currentUserId) return
        if (typeof payload.userId === 'string' && typeof payload.typing === 'boolean') {
          onMemberTyping(payload.userId, payload.typing)
        }
      })
      .subscribe((status) => {
        subscribed = status === 'SUBSCRIBED'
        if (subscribed && channel && pendingTyping !== lastSentTyping) {
          lastSentTyping = pendingTyping
          void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing: pendingTyping } })
        }
      })
  })

  const publish = (typing: boolean) => {
    pendingTyping = typing
    if (!channel || !subscribed || stopped || lastSentTyping === typing) return
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
      if (channel && subscribed && pendingTyping) {
        void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing: false } })
      }
      stopped = true
      if (channel) void supabase.removeChannel(channel)
      channel = null
    },
  }
}
