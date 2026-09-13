import {
  useEffect,
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
  getPlanMessages,
  sendPlanMessage,
  type PlanConversation,
  type PlanMessage,
} from './messagingClient'
import {
  subscribeToPlanMessagesRealtime,
} from './messagingRealtime'
import PlanGovernancePanel from '../plan/PlanGovernancePanel'
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
  initialPlanId?: string | null
  initialDirectConversationId?: string | null
  onPlanEnded?: (reason: 'left' | 'ended' | 'safety') => void
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

function formatMessageTime(
  sentAt: string,
): string {
  const date = new Date(sentAt)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: 'numeric',
      minute: '2-digit',
    },
  ).format(date)
}

export default function MessagesView({
  currentUserId,
  initialPlanId = null,
  initialDirectConversationId = null,
  onPlanEnded,
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
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [hasMoreConversations, setHasMoreConversations] = useState(false)
  const [conversationCursor, setConversationCursor] = useState<{ createdAt: string; conversationId: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] =
    useState<string | null>(null)

  const selectedPlanId =
    conversations.find(
      (conversation) =>
        conversation.conversationId === selectedConversationId,
    )?.planId ?? null

  useEffect(() => {
    let cancelled = false

    const loadConversations = async () => {
      setLoadingConversations(true)
      setError(null)

      try {
        const page = await getMyPlanConversationsPage()
        let visible = page
        let deepLinked: PlanConversation | null = null

        if (initialPlanId && !page.some((item) => item.planId === initialPlanId)) {
          deepLinked = await getMyPlanConversation(initialPlanId)
          if (deepLinked) visible = mergePlanConversations(page, [deepLinked])
        }

        if (cancelled) return
        setConversations(visible)
        setHasMoreConversations(page.length === PLAN_CONVERSATION_PAGE_SIZE)
        const last = page[page.length - 1]
        setConversationCursor(last ? { createdAt: last.createdAt, conversationId: last.conversationId } : null)

        const target = initialPlanId
          ? visible.find((item) => item.planId === initialPlanId) ?? deepLinked
          : null
        if (target) setSelectedConversationId(target.conversationId)
      } catch (loadError) {
        if (!cancelled) setError(toUserFacingError(loadError, 'Unable to load conversations right now.'))
      } finally {
        if (!cancelled) setLoadingConversations(false)
      }
    }

    void loadConversations()
    return () => { cancelled = true }
  }, [initialPlanId])

  useEffect(() => {
    if (selectedConversationId === null) {
      return
    }

    let cancelled = false

    const loadMessages = async () => {
      setLoadingMessages(true)
      setError(null)

      try {
        const result =
          await getPlanMessages(
            selectedConversationId,
          )

        if (!cancelled) {
          setMessages(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            toUserFacingError(loadError, 'Unable to load messages right now.'),
          )
        }
      } finally {
        if (!cancelled) {
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
            if (!cancelled) {
              setMessages(nextMessages)
            }
          },
          onError: (realtimeError) => {
            if (!cancelled) {
              setError(toUserFacingError(realtimeError, 'Messages lost connection. Reconnecting…'))
            }
          },
        },
      )

    return () => {
      cancelled = true
      void subscription.stop()
    }
  }, [selectedConversationId])

  useEffect(() => {
    if (!selectedPlanId) return

    let cancelled = false

    const refreshMembers = async () => {
      try {
        const next = await getMyPlanMembers(selectedPlanId)
        if (!cancelled) setPlanMembers(next)
      } catch (memberError) {
        if (!cancelled) {
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

  const loadMoreConversations = async () => {
    if (!conversationCursor || loadingMoreConversations) return
    setLoadingMoreConversations(true)
    setError(null)

    try {
      const page = await getMyPlanConversationsPage(conversationCursor)
      setConversations((current) => mergePlanConversations(current, page))
      setHasMoreConversations(page.length === PLAN_CONVERSATION_PAGE_SIZE)
      const last = page[page.length - 1]
      setConversationCursor(last
        ? { createdAt: last.createdAt, conversationId: last.conversationId }
        : null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load older Plan conversations right now.'))
    } finally {
      setLoadingMoreConversations(false)
    }
  }

  const handleSend = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (
      selectedConversationId === null ||
      sending ||
      draft.trim().length === 0
    ) {
      return
    }

    setSending(true)
    setError(null)

    try {
      const sentMessage =
        await sendPlanMessage(
          selectedConversationId,
          draft,
        )

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

      setDraft('')
    } catch (sendError) {
      setError(
        toUserFacingError(sendError, 'Unable to send your message right now.'),
      )
    } finally {
      setSending(false)
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
          <button
            type="button"
            className="messages-back-button"
            onClick={() => {
              setMessages([])
              setSelectedConversationId(null)
            }}
          >
            <ArrowLeft size={18} />
            MESSAGES
          </button>

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

        {selectedConversation && planMembers.length > 0 && (
          <div className="messages-plan-members" aria-label="Plan members">
            {planMembers.slice(0, 8).map((member) => (
              <div className="messages-plan-member" key={member.userId}>
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt="" />
                ) : (
                  <span aria-hidden="true">
                    {member.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <small>{member.isMe ? 'YOU' : member.displayName}</small>
              </div>
            ))}
            {planMembers.length > 8 && (
              <strong>+{planMembers.length - 8}</strong>
            )}
          </div>
        )}

        {selectedConversation && (
          <PlanGovernancePanel
            planId={selectedConversation.planId}
            onLeftPlan={(reason) => {
              setMessages([])
              setPlanMembers([])
              setError(null)
              setConversations((current) =>
                current.filter(
                  (conversation) =>
                    conversation.planId !== selectedConversation.planId,
                ),
              )
              setSelectedConversationId(null)
              onPlanEnded?.(reason)
            }}
          />
        )}

        <div className="messages-thread-feed">
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
                    {!isMine && (
                      sender?.avatarUrl ? (
                        <img src={sender.avatarUrl} alt="" />
                      ) : (
                        <span aria-hidden="true">
                          {(sender?.displayName ?? 'S').slice(0, 1).toUpperCase()}
                        </span>
                      )
                    )}
                    <small>
                      {isMine ? 'YOU' : sender?.displayName ?? 'SIGNAL MEMBER'}
                    </small>
                  </div>
                  <p>{message.body}</p>
                  <time>
                    {formatMessageTime(
                      message.sentAt,
                    )}
                  </time>
                </article>
              )
            })
          )}
        </div>

        <form
          className="messages-compose"
          onSubmit={handleSend}
        >
          <input
            value={draft}
            onChange={(event) =>
              setDraft(event.target.value)
            }
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

      <DirectMessagesPanel currentUserId={currentUserId} initialConversationId={initialDirectConversationId} />

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
            disabled={loadingMoreConversations}
          >
            {loadingMoreConversations ? 'LOADING…' : 'LOAD OLDER PLAN CHATS'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
