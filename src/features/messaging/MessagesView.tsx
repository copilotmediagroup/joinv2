import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  FormEvent,
} from 'react'
import {
  ArrowLeft,
  MessageCircle,
  Send,
  Zap,
} from 'lucide-react'
import {
  getMyPlanConversation,
  getMyPlanConversationsPage,
  PLAN_CONVERSATION_PAGE_SIZE,
  getPlanMessagesPage,
  sendPlanMessage,
  type PlanConversation,
  type PlanMessage,
} from './messagingClient'
import {
  subscribeToPlanMessagesRealtime,
  subscribeToPlanTyping,
} from './messagingRealtime'
import {
  getMyPlanMembers,
  subscribeToPlanMembers,
  type PlanMemberIdentity,
} from '../plan/planMembersClient'
import './MessagesView.css'
import { toUserFacingError } from '../../lib/userFacingError'
import DirectMessagesPanel from './DirectMessagesPanel'

type MessagesViewProps = {
  currentUserId: string
  currentUserAvatarUrl?: string | null
  initialPlanId?: string | null
  initialDirectConversationId?: string | null
  lockedPlanId?: string | null
}

function mergePlanConversations(
  current: PlanConversation[],
  incoming: PlanConversation[],
): PlanConversation[] {
  const byId = new Map(current.map((item) => [item.conversationId, item]))
  incoming.forEach((item) => byId.set(item.conversationId, item))
  return [...byId.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) ||
    right.conversationId.localeCompare(left.conversationId),
  )
}

function formatMessageStamp(sentAt: string): { date: string; time: string } {
  const date = new Date(sentAt)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }

  const today = new Date()
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()

  return {
    date: sameDay
      ? 'Today'
      : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
      }).format(date),
    time: new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
  }
}

export default function MessagesView({
  currentUserId,
  currentUserAvatarUrl = null,
  initialPlanId = null,
  initialDirectConversationId = null,
  lockedPlanId = null,
}: MessagesViewProps) {
  const [conversations, setConversations] =
    useState<PlanConversation[]>([])
  const [selectedConversationId, setSelectedConversationId] =
    useState<string | null>(null)
  const [messages, setMessages] =
    useState<PlanMessage[]>([])
  const [planMembers, setPlanMembers] =
    useState<PlanMemberIdentity[]>([])
  const [draft, setDraft] = useState('')
  const [loadingConversations, setLoadingConversations] =
    useState(true)
  const [loadingMessages, setLoadingMessages] =
    useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [conversationCursor, setConversationCursor] = useState<{ createdAt: string; conversationId: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] =
    useState<string | null>(null)
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const typingPublisherRef = useRef<((typing: boolean) => void) | null>(null)
  const groupFeedRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowGroupLatestRef = useRef(true)
  const groupMessageEpochRef = useRef(0)
  const groupMessagePageRequestRef = useRef(false)
  const sendRequestRef = useRef(false)
  const groupConversationPageRequestRef = useRef(false)
  const groupConversationEpochRef = useRef(0)

  const selectedPlanId =
    conversations.find(
      (conversation) =>
        conversation.conversationId === selectedConversationId,
    )?.planId ?? null

  useEffect(() => {
    let cancelled = false

    const requestEpoch = ++groupConversationEpochRef.current
    const loadConversations = async () => {
      setLoadingConversations(true)
      setError(null)

      try {
        const lockedConversation = lockedPlanId
          ? await getMyPlanConversation(lockedPlanId)
          : null
        const page = lockedPlanId ? [] : await getMyPlanConversationsPage()
        let visible = lockedPlanId
          ? (lockedConversation ? [lockedConversation] : [])
          : page
        let deepLinked: PlanConversation | null = lockedConversation

        if (!lockedPlanId && initialPlanId && !page.some((item) => item.planId === initialPlanId)) {
          deepLinked = await getMyPlanConversation(initialPlanId)
          if (deepLinked) visible = mergePlanConversations(page, [deepLinked])
        }

        if (cancelled || requestEpoch !== groupConversationEpochRef.current) return
        setConversations(visible)
        setHasMoreConversations(page.length === PLAN_CONVERSATION_PAGE_SIZE)
        const last = page[page.length - 1]
        setConversationCursor(last ? { createdAt: last.createdAt, conversationId: last.conversationId } : null)

        const targetPlanId = lockedPlanId ?? initialPlanId
        const target = targetPlanId
          ? visible.find((item) => item.planId === targetPlanId) ?? deepLinked
          : null
        if (target) setSelectedConversationId(target.conversationId)
      } catch (loadError) {
        if (!cancelled && requestEpoch === groupConversationEpochRef.current) setError(toUserFacingError(loadError, 'Unable to load conversations right now.'))
      } finally {
        if (!cancelled && requestEpoch === groupConversationEpochRef.current) setLoadingConversations(false)
      }
    }

    void loadConversations()
    return () => { cancelled = true; groupConversationEpochRef.current += 1 }
  }, [initialPlanId, lockedPlanId])

  useEffect(() => {
    if (selectedConversationId === null) {
      return
    }

    let cancelled = false
    const messageEpoch = ++groupMessageEpochRef.current

    const loadMessages = async () => {
      setLoadingMessages(true)
      setError(null)

      try {
        const page =
          await getPlanMessagesPage(
            selectedConversationId,
          )

        if (!cancelled && messageEpoch === groupMessageEpochRef.current) {
          setMessages(page.messages)
          setHasOlderMessages(page.hasOlder)
        }
      } catch (loadError) {
        if (!cancelled && messageEpoch === groupMessageEpochRef.current) {
          setError(
            toUserFacingError(loadError, 'Unable to load messages right now.'),
          )
        }
      } finally {
        if (!cancelled && messageEpoch === groupMessageEpochRef.current) {
          setLoadingMessages(false)
        }
      }
    }

    void loadMessages()

    const subscription =
      subscribeToPlanMessagesRealtime(
        selectedConversationId,
        {
          onMessages: (nextMessages) => {
            if (!cancelled && messageEpoch === groupMessageEpochRef.current) {
              setMessages((current) => {
                const byId = new Map(current.map((message) => [message.messageId, message]))
                nextMessages.forEach((message) => byId.set(message.messageId, message))
                return [...byId.values()].sort((left, right) =>
                  left.sentAt.localeCompare(right.sentAt) || left.messageId.localeCompare(right.messageId))
              })
            }
          },
          onError: (realtimeError) => {
            if (!cancelled && messageEpoch === groupMessageEpochRef.current) {
              setError(toUserFacingError(realtimeError, 'Messages lost connection. Reconnecting…'))
            }
          },
        },
      )

    return () => {
      cancelled = true
      groupMessageEpochRef.current += 1
      void subscription.stop()
    }
  }, [selectedConversationId])

  useEffect(() => {
    if (!selectedPlanId) return

    let cancelled = false
    let refreshEpoch = 0

    const refreshMembers = async () => {
      const requestEpoch = ++refreshEpoch
      try {
        const next = await getMyPlanMembers(selectedPlanId)
        if (!cancelled && requestEpoch === refreshEpoch) setPlanMembers(next)
      } catch (memberError) {
        if (!cancelled && requestEpoch === refreshEpoch) {
          setError(
            toUserFacingError(memberError, 'Unable to load Plan members right now.'),
          )
        }
      }
    }

    void refreshMembers()
    const unsubscribe = subscribeToPlanMembers(
      selectedPlanId,
      () => { void refreshMembers() },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [selectedPlanId])

  useEffect(() => {
    if (!selectedConversationId) return
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
    let typingActive = true
    const typing = subscribeToPlanTyping(selectedConversationId, currentUserId, (userId, active) => {
      if (!typingActive) return
      const existing = idleTimers.get(userId)
      if (existing) clearTimeout(existing)
      idleTimers.delete(userId)
      setTypingUserIds((current) => active
        ? (current.includes(userId) ? current : [...current, userId])
        : current.filter((id) => id !== userId))
      if (active) {
        idleTimers.set(userId, setTimeout(() => {
          idleTimers.delete(userId)
          setTypingUserIds((current) => current.filter((id) => id !== userId))
        }, 3000))
      }
    })
    typingPublisherRef.current = typing.setTyping
    return () => {
      typingActive = false
      idleTimers.forEach((timer) => clearTimeout(timer))
      typing.stop()
      typingPublisherRef.current = null
      setTypingUserIds([])
    }
  }, [currentUserId, selectedConversationId])

  useEffect(() => {
    if (!selectedConversationId || messages.length === 0 || !shouldFollowGroupLatestRef.current) return
    const frame = requestAnimationFrame(() => {
      const feed = groupFeedRef.current
      if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, selectedConversationId])

  const captureGroupFollowState = () => {
    const feed = groupFeedRef.current
    if (!feed) return
    shouldFollowGroupLatestRef.current =
      feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
  }

  const loadOlderMessages = async () => {
    const oldest = messages[0]
    if (!selectedConversationId || !oldest || groupMessagePageRequestRef.current || sendRequestRef.current || !hasOlderMessages) return
    const requestedConversationId = selectedConversationId
    const requestEpoch = groupMessageEpochRef.current
    const feed = groupFeedRef.current
    const previousHeight = feed?.scrollHeight ?? 0
    groupMessagePageRequestRef.current = true
    setLoadingOlderMessages(true)
    setError(null)
    try {
      const page = await getPlanMessagesPage(requestedConversationId, {
        sentAt: oldest.sentAt,
        messageId: oldest.messageId,
      })
      if (requestedConversationId !== selectedConversationId || requestEpoch !== groupMessageEpochRef.current) return
      setMessages((current) => {
        const byId = new Map([...page.messages, ...current].map((message) => [message.messageId, message]))
        return [...byId.values()].sort((left, right) =>
          left.sentAt.localeCompare(right.sentAt) || left.messageId.localeCompare(right.messageId))
      })
      setHasOlderMessages(page.hasOlder)
      requestAnimationFrame(() => {
        const currentFeed = groupFeedRef.current
        if (currentFeed) currentFeed.scrollTop += currentFeed.scrollHeight - previousHeight
      })
    } catch (loadError) {
      if (requestedConversationId === selectedConversationId && requestEpoch === groupMessageEpochRef.current) {
        setError(toUserFacingError(loadError, 'Unable to load older group messages right now.'))
      }
    } finally {
      groupMessagePageRequestRef.current = false
      if (requestedConversationId === selectedConversationId && requestEpoch === groupMessageEpochRef.current) {
        setLoadingOlderMessages(false)
      }
    }
  }

  const loadMoreConversations = async () => {
    if (!conversationCursor || groupConversationPageRequestRef.current || sendRequestRef.current) return
    const requestEpoch = groupConversationEpochRef.current
    groupConversationPageRequestRef.current = true
    setLoadingMoreConversations(true)
    setError(null)

    try {
      const page = await getMyPlanConversationsPage(conversationCursor)
      if (requestEpoch !== groupConversationEpochRef.current) return
      setConversations((current) => mergePlanConversations(current, page))
      setHasMoreConversations(page.length === PLAN_CONVERSATION_PAGE_SIZE)
      const last = page[page.length - 1]
      setConversationCursor(last
        ? { createdAt: last.createdAt, conversationId: last.conversationId }
        : null)
    } catch (loadError) {
      if (requestEpoch === groupConversationEpochRef.current) setError(toUserFacingError(loadError, 'Unable to load older Plan conversations right now.'))
    } finally {
      groupConversationPageRequestRef.current = false
      if (requestEpoch === groupConversationEpochRef.current) setLoadingMoreConversations(false)
    }
  }

  const handleSend = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (
      selectedConversationId === null ||
      sendRequestRef.current ||
      draft.trim().length === 0
    ) {
      return
    }

    sendRequestRef.current = true
    setSending(true)
    setError(null)

    const requestedConversationId = selectedConversationId
    const sendEpoch = groupMessageEpochRef.current
    try {
      shouldFollowGroupLatestRef.current = true
      const sentMessage =
        await sendPlanMessage(
          requestedConversationId,
          draft,
        )

      if (requestedConversationId !== selectedConversationId || sendEpoch !== groupMessageEpochRef.current) return
      setMessages((current) => {
        if (
          current.some(
            (message) =>
              message.messageId ===
              sentMessage.messageId,
          )
        ) {
          return current
        }

        return [
          ...current,
          sentMessage,
        ].sort((left, right) => {
          const sentAtDifference =
            left.sentAt.localeCompare(
              right.sentAt,
            )

          if (sentAtDifference !== 0) {
            return sentAtDifference
          }

          return left.messageId.localeCompare(
            right.messageId,
          )
        })
      })

      typingPublisherRef.current?.(false)
      setDraft('')
    } catch (sendError) {
      if (requestedConversationId !== selectedConversationId || sendEpoch !== groupMessageEpochRef.current) return
      setError(
        toUserFacingError(sendError, 'Unable to send your message right now.'),
      )
    } finally {
      sendRequestRef.current = false
      if (requestedConversationId === selectedConversationId && sendEpoch === groupMessageEpochRef.current) setSending(false)
    }
  }

  if (selectedConversationId !== null) {
    const selectedConversation =
      conversations.find(
        (conversation) =>
          conversation.conversationId ===
          selectedConversationId,
      ) ?? null

    return (
      <section className="messages-view messages-thread-view">
        <header className="messages-view-header">
          {!lockedPlanId && <button
            type="button"
            className="messages-back-button"
            onClick={() => {
              setMessages([])
              setHasOlderMessages(false)
              setSelectedConversationId(null)
            }}
          >
            <ArrowLeft size={18} />
            MESSAGES
          </button>}

          <div className="messages-thread-title">
            <span>
              <Zap
                size={14}
                fill="currentColor"
              />
              SIGNAL PLAN
            </span>
            <strong>
              {selectedConversation
                ? 'GROUP CHAT'
                : 'MESSAGES'}
            </strong>
          </div>
        </header>

        {error && (
          <div
            className="messages-error"
            role="alert"
          >
            {error}
          </div>
        )}


        <div className="messages-chat-section">
          <div className="messages-chat-heading">
            <strong>GROUP CHAT</strong>
            <span>{messages.length > 0 ? 'LIVE CONVERSATION' : 'START THE CONVERSATION'}</span>
          </div>
        <div
          className="messages-thread-feed"
          ref={groupFeedRef}
          onScroll={captureGroupFollowState}
        >
          {hasOlderMessages ? <button type="button" className="messages-load-older-thread" disabled={loadingOlderMessages || sending} onClick={() => { void loadOlderMessages() }}>{loadingOlderMessages ? 'LOADING…' : 'LOAD OLDER MESSAGES'}</button> : null}
          {loadingMessages ? (
            <div className="messages-state">
              Loading messages…
            </div>
          ) : messages.length === 0 ? (
            <div className="messages-empty-thread">
              <MessageCircle size={28} />
              <strong>
                Start the conversation
              </strong>
              <span>
                Your Signal group chat is ready.
              </span>
            </div>
          ) : (
            messages.map((message) => {
              const isMine =
                message.senderUserId ===
                currentUserId
              const sender = planMembers.find(
                (member) => member.userId === message.senderUserId,
              )

              const sent = formatMessageStamp(message.sentAt)

              return (
                <article
                  key={message.messageId}
                  className={
                    isMine
                      ? 'messages-bubble messages-bubble-mine'
                      : 'messages-bubble'
                  }
                >
                  <div className="messages-bubble-identity">
                    {isMine && currentUserAvatarUrl ? (
                      <img src={currentUserAvatarUrl} alt="" />
                    ) : !isMine && sender?.avatarUrl ? (
                      <img src={sender.avatarUrl} alt="" />
                    ) : (
                      <span aria-hidden="true">
                        {isMine ? 'Y' : (sender?.displayName ?? 'S').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <small>
                      {isMine ? 'YOU' : sender?.displayName ?? 'SIGNAL MEMBER'}
                    </small>
                  </div>
                  <p>{message.body}</p>
                  <time>
                    {sent.date} · {sent.time}
                  </time>
                </article>
              )
            })
          )}
        </div>

        </div>

        <div className={`direct-typing-indicator ${typingUserIds.length > 0 ? 'is-visible' : ''}`} aria-live="polite">
          {typingUserIds.length > 0 ? <>
            <span><i/><i/><i/></span>
            {typingUserIds.map((userId) => planMembers.find((member) => member.userId === userId)?.displayName ?? 'SIGNAL MEMBER').join(', ')} {typingUserIds.length === 1 ? 'is' : 'are'} typing…
          </> : null}
        </div>

        <form
          className="messages-compose"
          onSubmit={handleSend}
        >
          <input
            value={draft}
            onChange={(event) => {
              const next = event.target.value
              setDraft(next)
              typingPublisherRef.current?.(next.trim().length > 0)
            }}
            maxLength={4000}
            aria-label="Message group"
            placeholder="Message the group..."
            disabled={sending}
          />

          <button
            type="submit"
            aria-label="Send message"
            disabled={
              sending ||
              draft.trim().length === 0
            }
          >
            <Send size={18} />
          </button>
        </form>
      </section>
    )
  }

  if (lockedPlanId) {
    return (
      <section className="messages-view messages-thread-view">
        <div className="messages-state">
          {loadingConversations ? 'Opening your live Signal group…' : 'Live Signal group chat is unavailable right now.'}
        </div>
        {error && <div className="messages-error" role="alert">{error}</div>}
      </section>
    )
  }

  return (
    <section className="messages-view">
      <header className="messages-list-header">
        <div>
          <span className="eyebrow">
            <Zap
              size={13}
              fill="currentColor"
            />
            SIGNAL
          </span>
          <h1>Messages</h1>
          <p>
            Your active Signal conversations.
          </p>
        </div>
      </header>

      {error && (
        <div
          className="messages-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <DirectMessagesPanel currentUserId={currentUserId} currentUserAvatarUrl={currentUserAvatarUrl} initialConversationId={initialDirectConversationId} />

      <div className="messages-conversation-list">
        {loadingConversations ? (
          <div className="messages-state">
            Loading conversations…
          </div>
        ) : conversations.length === 0 ? (
          <div className="messages-empty">
            <MessageCircle size={30} />
            <strong>No conversations yet</strong>
            <span>
              Group chat opens when a Signal
              becomes a Plan.
            </span>
          </div>
        ) : (
          conversations.map(
            (conversation) => (
              <button
                key={conversation.conversationId}
                type="button"
                className="messages-conversation-row"
                onClick={() => {
                  setMessages([])
                  setHasOlderMessages(false)
                  setSelectedConversationId(
                    conversation.conversationId,
                  )
                }}
              >
                <span className="messages-conversation-icon">
                  <Zap
                    size={18}
                    fill="currentColor"
                  />
                </span>

                <span className="messages-conversation-copy">
                  <strong>
                    SIGNAL GROUP
                  </strong>
                  <small>
                    Plan conversation
                  </small>
                </span>

                <MessageCircle size={18} />
              </button>
            ),
          )
        )}
        {hasMoreConversations ? (
          <button
            type="button"
            className="messages-load-more"
            onClick={() => { void loadMoreConversations() }}
            disabled={loadingMoreConversations || sending}
          >
            {loadingMoreConversations ? 'LOADING…' : 'LOAD OLDER PLAN CHATS'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
