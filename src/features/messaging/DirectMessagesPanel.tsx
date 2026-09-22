import { ArrowLeft, MessageCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  DIRECT_THREAD_PAGE_SIZE,
  getMyDirectMessagesPage,
  getMyDirectThread,
  getMyDirectThreadsPage,
  markMyDirectConversationRead,
  sendMyDirectMessage,
  subscribeToDirectMessages,
  subscribeToDirectTyping,
  type DirectMessage,
  type DirectThread,
} from './directMessagingClient'
import UserSafetyActions from '../safety/UserSafetyActions'

function stamp(value: string): { date: string; time: string } {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' }
  const today = new Date()
  const sameDay = parsed.getFullYear() === today.getFullYear() && parsed.getMonth() === today.getMonth() && parsed.getDate() === today.getDate()
  return {
    date: sameDay ? 'Today' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: parsed.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(parsed),
    time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(parsed),
  }
}

function mergeThreads(current: DirectThread[], incoming: DirectThread[]): DirectThread[] {
  const byId = new Map(current.map((thread) => [thread.conversationId, thread]))
  incoming.forEach((thread) => byId.set(thread.conversationId, thread))
  return [...byId.values()].sort((left, right) =>
    right.sortAt.localeCompare(left.sortAt) || right.conversationId.localeCompare(left.conversationId))
}
export default function DirectMessagesPanel({
  currentUserId,
  currentUserAvatarUrl = null,
  initialConversationId = null,
}: {
  currentUserId: string
  currentUserAvatarUrl?: string | null
  initialConversationId?: string | null
}) {
  const [threads, setThreads] = useState<DirectThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [sending, setSending] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [otherUserTyping, setOtherUserTyping] = useState(false)
  const typingPublisherRef = useRef<((typing: boolean) => void) | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowLatestRef = useRef(true)
  const messageRefreshEpochRef = useRef(0)
  const messagePageRequestRef = useRef(false)
  const sendRequestRef = useRef(false)
  const threadPageRequestRef = useRef(false)
  const threadRefreshEpochRef = useRef(0)

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const feed = feedRef.current
    if (!feed) return
    feed.scrollTo({ top: feed.scrollHeight, behavior })
  }, [])

  const captureFollowState = () => {
    const feed = feedRef.current
    if (!feed) return
    shouldFollowLatestRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
  }

  const selected = useMemo(
    () => threads.find((thread) => thread.conversationId === selectedId) ?? null,
    [threads, selectedId],
  )

  const loadInitialThreads = useCallback(async () => {
    const requestEpoch = ++threadRefreshEpochRef.current
    try {
      const page = await getMyDirectThreadsPage()
      if (requestEpoch !== threadRefreshEpochRef.current) return
      setThreads(page)
      setHasMore(page.length === DIRECT_THREAD_PAGE_SIZE)
      setError(null)
    } catch (loadError) {
      if (requestEpoch === threadRefreshEpochRef.current) setError(toUserFacingError(loadError, 'Unable to load direct messages right now.'))
    } finally {
      if (requestEpoch === threadRefreshEpochRef.current) setLoading(false)
    }
  }, [])
  const hydrateSelectedThread = useCallback(async (conversationId: string) => {
    const requestEpoch = threadRefreshEpochRef.current
    const thread = await getMyDirectThread(conversationId)
    if (requestEpoch !== threadRefreshEpochRef.current) return
    if (thread) setThreads((current) => mergeThreads(current, [thread]))
  }, [])

  const refreshMessages = useCallback(async (reset = false) => {
    if (!selectedId) return
    const requestedConversationId = selectedId
    const requestEpoch = ++messageRefreshEpochRef.current
    try {
      const page = await getMyDirectMessagesPage(requestedConversationId)
      if (
        requestedConversationId !== selectedId
        || requestEpoch !== messageRefreshEpochRef.current
      ) return
      setMessages((current) => {
        if (reset || current.some((message) => message.conversationId !== requestedConversationId)) return page.messages
        const byId = new Map(current.map((message) => [message.messageId, message]))
        page.messages.forEach((message) => byId.set(message.messageId, message))
        return [...byId.values()].sort((left, right) =>
          left.sentAt.localeCompare(right.sentAt) || left.messageId.localeCompare(right.messageId))
      })
      if (reset) setHasOlderMessages(page.hasOlder)
      await markMyDirectConversationRead(requestedConversationId)
      await hydrateSelectedThread(requestedConversationId)
      if (
        requestedConversationId !== selectedId
        || requestEpoch !== messageRefreshEpochRef.current
      ) return
      setError(null)
    } catch (loadError) {
      if (
        requestedConversationId !== selectedId
        || requestEpoch !== messageRefreshEpochRef.current
      ) return
      setError(toUserFacingError(loadError, 'Unable to load this conversation right now.'))
    }
  }, [hydrateSelectedThread, selectedId])

  const loadOlderMessages = async () => {
    const oldest = messages[0]
    if (!selectedId || !oldest || messagePageRequestRef.current || sendRequestRef.current || !hasOlderMessages) return
    const requestedConversationId = selectedId
    const requestEpoch = messageRefreshEpochRef.current
    const feed = feedRef.current
    const previousHeight = feed?.scrollHeight ?? 0
    messagePageRequestRef.current = true
    setLoadingOlderMessages(true)
    try {
      const page = await getMyDirectMessagesPage(requestedConversationId, { sentAt: oldest.sentAt, messageId: oldest.messageId })
      if (requestedConversationId !== selectedId || requestEpoch !== messageRefreshEpochRef.current) return
      setMessages((current) => {
        const byId = new Map([...page.messages, ...current].map((message) => [message.messageId, message]))
        return [...byId.values()].sort((left, right) =>
          left.sentAt.localeCompare(right.sentAt) || left.messageId.localeCompare(right.messageId))
      })
      setHasOlderMessages(page.hasOlder)
      requestAnimationFrame(() => {
        const currentFeed = feedRef.current
        if (currentFeed) currentFeed.scrollTop += currentFeed.scrollHeight - previousHeight
      })
      setError(null)
    } catch (loadError) {
      if (requestedConversationId === selectedId && requestEpoch === messageRefreshEpochRef.current) {
        setError(toUserFacingError(loadError, 'Unable to load older messages right now.'))
      }
    } finally {
      messagePageRequestRef.current = false
      if (requestedConversationId === selectedId && requestEpoch === messageRefreshEpochRef.current) {
        setLoadingOlderMessages(false)
      }
    }
  }

  const loadMore = async () => {
    const last = threads[threads.length - 1]
    if (!last || threadPageRequestRef.current || sendRequestRef.current) return
    const requestEpoch = threadRefreshEpochRef.current
    threadPageRequestRef.current = true
    setLoadingMore(true)
    try {
      const page = await getMyDirectThreadsPage({
        sortAt: last.sortAt,
        conversationId: last.conversationId,
      })
      if (requestEpoch !== threadRefreshEpochRef.current) return
      setThreads((current) => mergeThreads(current, page))
      setHasMore(page.length === DIRECT_THREAD_PAGE_SIZE)
      setError(null)
    } catch (loadError) {
      if (requestEpoch === threadRefreshEpochRef.current) setError(toUserFacingError(loadError, 'Unable to load older conversations right now.'))
    } finally {
      threadPageRequestRef.current = false
      if (requestEpoch === threadRefreshEpochRef.current) setLoadingMore(false)
    }
  }
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void loadInitialThreads() })
    return () => { active = false; threadRefreshEpochRef.current += 1 }
  }, [loadInitialThreads])

  useEffect(() => {
    if (!initialConversationId) return
    let active = true
    queueMicrotask(() => {
      if (active) void hydrateSelectedThread(initialConversationId)
    })
    return () => { active = false; threadRefreshEpochRef.current += 1 }
  }, [hydrateSelectedThread, initialConversationId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    queueMicrotask(() => { if (active) void refreshMessages(true) })
    const stop = subscribeToDirectMessages(selectedId, () => {
      if (active) void refreshMessages(false)
    })
    return () => { active = false; messageRefreshEpochRef.current += 1; stop() }
  }, [refreshMessages, selectedId])

  useEffect(() => {
    if (!selectedId || messages.length === 0 || !shouldFollowLatestRef.current) return
    const frame = requestAnimationFrame(() => scrollToLatest())
    return () => cancelAnimationFrame(frame)
  }, [messages, scrollToLatest, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const typing = subscribeToDirectTyping(selectedId, currentUserId, (active) => {
      setOtherUserTyping(active)
      if (idleTimer) clearTimeout(idleTimer)
      if (active) idleTimer = setTimeout(() => setOtherUserTyping(false), 3000)
    })
    typingPublisherRef.current = typing.setTyping
    return () => { if (idleTimer) clearTimeout(idleTimer); typing.stop(); typingPublisherRef.current = null }
  }, [currentUserId, selectedId])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId || sendRequestRef.current || !draft.trim()) return
    const requestedConversationId = selectedId
    const sendEpoch = messageRefreshEpochRef.current
    sendRequestRef.current = true
    setSending(true)
    setError(null)
    try {
      shouldFollowLatestRef.current = true
      await sendMyDirectMessage(requestedConversationId, draft)
      if (requestedConversationId !== selectedId || sendEpoch !== messageRefreshEpochRef.current) return
      typingPublisherRef.current?.(false)
      setDraft('')
      await refreshMessages()
    } catch (sendError) {
      if (requestedConversationId !== selectedId || sendEpoch !== messageRefreshEpochRef.current) return
      setError(toUserFacingError(sendError, 'Unable to send your message right now.'))
    } finally {
      sendRequestRef.current = false
      if (requestedConversationId === selectedId && sendEpoch === messageRefreshEpochRef.current) setSending(false)
    }
  }
  if (selectedId) {
    return <section className="direct-thread">
      <header>
        <button type="button" onClick={() => { messageRefreshEpochRef.current += 1; setSelectedId(null); setMessages([]); setOtherUserTyping(false) }}>
          <ArrowLeft size={16}/> DIRECT
        </button>
        <div>
          {selected?.avatarUrl ? <img src={selected.avatarUrl} alt=""/> : null}
          <strong>{selected?.displayName ?? 'CONNECTED MEMBER'}</strong>
        </div>
      </header>
      {error ? <p className="messages-error" role="alert">{error}</p> : null}
      {selected ? <UserSafetyActions
        userId={selected.otherUserId}
        displayName={selected.displayName}
        onBlocked={() => {
          setSelectedId(null)
          setMessages([])
          void loadInitialThreads()
        }}
      /> : null}
      <div className="messages-thread-feed" ref={feedRef} onScroll={captureFollowState}>
        {hasOlderMessages ? <button type="button" className="direct-load-older-messages" disabled={loadingOlderMessages || sending} onClick={() => { void loadOlderMessages() }}>{loadingOlderMessages ? 'LOADING…' : 'LOAD OLDER MESSAGES'}</button> : null}
        {messages.length === 0 ? <div className="messages-empty-thread">
          <MessageCircle size={26}/><strong>Start the conversation</strong>
          <span>You connected through SIGNAL.</span>
        </div> : messages.map((message) => <article
          key={message.messageId}
          className={message.senderUserId === currentUserId ? 'messages-bubble messages-bubble-mine' : 'messages-bubble'}
        >
          {(() => {
            const mine = message.senderUserId === currentUserId
            const sent = stamp(message.sentAt)
            return <>
              <div className="direct-message-author">
                <span className="direct-message-avatar">{mine && currentUserAvatarUrl ? <img src={currentUserAvatarUrl} alt=""/> : !mine && selected?.avatarUrl ? <img src={selected.avatarUrl} alt=""/> : <span>{mine ? 'YOU' : (selected?.displayName ?? 'S').slice(0, 1).toUpperCase()}</span>}</span>
                <div><strong>{mine ? 'You' : selected?.displayName ?? 'Connection'}</strong><small>{sent.date} · {sent.time}</small></div>
              </div>
              <p>{message.body}</p>
            </>
          })()}
        </article>)}
      </div>
      <div className={`direct-typing-indicator ${otherUserTyping ? 'is-visible' : ''}`} aria-live="polite">
        {otherUserTyping ? <><span><i/><i/><i/></span>{selected?.displayName ?? 'Connection'} is typing…</> : null}
      </div>
      <form className="messages-compose" onSubmit={send}>
        <input
          value={draft}
          maxLength={4000}
          placeholder={`Message ${selected?.displayName ?? 'connection'}...`}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            typingPublisherRef.current?.(next.trim().length > 0)
          }}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !draft.trim()}><Send size={17}/></button>
      </form>
    </section>
  }

  return <section className="direct-messages-panel">
    <div className="direct-messages-heading">
      <span>DIRECT</span>
      <small>People you connected with through SIGNAL.</small>
    </div>
    {error ? <p className="messages-error" role="alert">{error}</p> : null}
    {loading ? <div className="messages-state">Loading direct messages…</div>
      : threads.length === 0 ? <div className="direct-messages-empty">
        <MessageCircle size={22}/><span>No direct conversations yet.</span>
      </div>
        : threads.map((thread) => <button
          type="button"
          className="direct-thread-row"
          key={thread.conversationId}
          onClick={() => { shouldFollowLatestRef.current = true; setOtherUserTyping(false); setMessages([]); setHasOlderMessages(false); setSelectedId(thread.conversationId) }}
        >
          {thread.avatarUrl ? <img src={thread.avatarUrl} alt=""/>
            : <span>{thread.displayName.slice(0, 1).toUpperCase()}</span>}
          <div><strong>{thread.displayName}</strong>
            <small>{thread.lastMessageBody ?? 'Connected through SIGNAL'}</small></div>
          {thread.unreadCount > 0 ? <b>{thread.unreadCount}</b> : null}
        </button>)}
    {hasMore ? <button
      type="button"
      className="direct-load-more"
      onClick={() => { void loadMore() }}
      disabled={loadingMore || sending}
    >
      {loadingMore ? 'LOADING…' : 'LOAD OLDER CONVERSATIONS'}
    </button> : null}
  </section>
}
