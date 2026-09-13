import { ArrowLeft, MessageCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  DIRECT_THREAD_PAGE_SIZE,
  getMyDirectMessages,
  getMyDirectThread,
  getMyDirectThreadsPage,
  markMyDirectConversationRead,
  sendMyDirectMessage,
  subscribeToDirectMessages,
  type DirectMessage,
  type DirectThread,
} from './directMessagingClient'
import UserSafetyActions from '../safety/UserSafetyActions'

function time(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function mergeThreads(current: DirectThread[], incoming: DirectThread[]): DirectThread[] {
  const byId = new Map(current.map((thread) => [thread.conversationId, thread]))
  incoming.forEach((thread) => byId.set(thread.conversationId, thread))
  return [...byId.values()].sort((left, right) =>
    right.sortAt.localeCompare(left.sortAt) || right.conversationId.localeCompare(left.conversationId))
}
export default function DirectMessagesPanel({
  currentUserId,
  initialConversationId = null,
}: {
  currentUserId: string
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
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => threads.find((thread) => thread.conversationId === selectedId) ?? null,
    [threads, selectedId],
  )

  const loadInitialThreads = useCallback(async () => {
    try {
      const page = await getMyDirectThreadsPage()
      setThreads(page)
      setHasMore(page.length === DIRECT_THREAD_PAGE_SIZE)
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load direct messages right now.'))
    } finally {
      setLoading(false)
    }
  }, [])
  const hydrateSelectedThread = useCallback(async (conversationId: string) => {
    const thread = await getMyDirectThread(conversationId)
    if (thread) setThreads((current) => mergeThreads(current, [thread]))
  }, [])

  const refreshMessages = useCallback(async () => {
    if (!selectedId) return
    try {
      setMessages(await getMyDirectMessages(selectedId))
      await markMyDirectConversationRead(selectedId)
      await hydrateSelectedThread(selectedId)
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load this conversation right now.'))
    }
  }, [hydrateSelectedThread, selectedId])

  const loadMore = async () => {
    const last = threads[threads.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getMyDirectThreadsPage({
        sortAt: last.sortAt,
        conversationId: last.conversationId,
      })
      setThreads((current) => mergeThreads(current, page))
      setHasMore(page.length === DIRECT_THREAD_PAGE_SIZE)
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load older conversations right now.'))
    } finally {
      setLoadingMore(false)
    }
  }
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void loadInitialThreads() })
    return () => { active = false }
  }, [loadInitialThreads])

  useEffect(() => {
    if (!initialConversationId) return
    let active = true
    queueMicrotask(() => {
      if (active) void hydrateSelectedThread(initialConversationId)
    })
    return () => { active = false }
  }, [hydrateSelectedThread, initialConversationId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    queueMicrotask(() => { if (active) void refreshMessages() })
    const stop = subscribeToDirectMessages(selectedId, () => {
      if (active) void refreshMessages()
    })
    return () => { active = false; stop() }
  }, [refreshMessages, selectedId])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedId || sending || !draft.trim()) return
    setSending(true)
    setError(null)
    try {
      await sendMyDirectMessage(selectedId, draft)
      setDraft('')
      await refreshMessages()
    } catch (sendError) {
      setError(toUserFacingError(sendError, 'Unable to send your message right now.'))
    } finally {
      setSending(false)
    }
  }
  if (selectedId) {
    return <section className="direct-thread">
      <header>
        <button type="button" onClick={() => { setSelectedId(null); setMessages([]) }}>
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
      <div className="messages-thread-feed">
        {messages.length === 0 ? <div className="messages-empty-thread">
          <MessageCircle size={26}/><strong>Start the conversation</strong>
          <span>You connected through SIGNAL.</span>
        </div> : messages.map((message) => <article
          key={message.messageId}
          className={message.senderUserId === currentUserId ? 'messages-bubble messages-bubble-mine' : 'messages-bubble'}
        >
          <small>{message.senderUserId === currentUserId ? 'YOU' : selected?.displayName ?? 'CONNECTION'}</small>
          <p>{message.body}</p><time>{time(message.sentAt)}</time>
        </article>)}
      </div>
      <form className="messages-compose" onSubmit={send}>
        <input
          value={draft}
          maxLength={4000}
          placeholder={`Message ${selected?.displayName ?? 'connection'}...`}
          onChange={(event) => setDraft(event.target.value)}
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
          onClick={() => setSelectedId(thread.conversationId)}
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
      disabled={loadingMore}
    >
      {loadingMore ? 'LOADING…' : 'LOAD OLDER CONVERSATIONS'}
    </button> : null}
  </section>
}
