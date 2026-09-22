import { Link2, MessageCircle, Unlink, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  disconnectMySignalConnection,
  getMySignalConnectionsPage,
  SIGNAL_CONNECTION_PAGE_SIZE,
  type MySignalConnection,
} from '../activity/signalConnectionsClient'
import { getOrCreateDirectConversation } from '../messaging/directMessagingClient'
import { getPublicProfileConnectionCount } from './publicProfileClient'
import UserSafetyActions from '../safety/UserSafetyActions'

function formatConnectedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default function MyConnectionsPanel({ userId, onOpenDirectConversation, onOpenProfile }: { userId: string; onOpenDirectConversation?: (conversationId: string) => void; onOpenProfile?: (userId: string) => void }) {
  const [connections, setConnections] = useState<MySignalConnection[]>([])
  const [connectionCount, setConnectionCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [safetyBusyId, setSafetyBusyId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<{ connectedAt: string; connectionId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshEpochRef = useRef(0)
  const pageRequestRef = useRef(false)
  const actionRequestRef = useRef(false)
  const actionEpochRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestEpoch = ++refreshEpochRef.current
    try {
      const [page, exactCount] = await Promise.all([
        getMySignalConnectionsPage(),
        getPublicProfileConnectionCount(userId),
      ])
      if (requestEpoch !== refreshEpochRef.current) return
      setConnections(page)
      setConnectionCount(exactCount)
      setHasMore(page.length === SIGNAL_CONNECTION_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? { connectedAt: last.connectedAt, connectionId: last.connectionId } : null)
      setError(null)
    } catch (loadError) {
      if (requestEpoch !== refreshEpochRef.current) return
      setError(toUserFacingError(loadError, 'Unable to load your connections right now.'))
    } finally {
      if (requestEpoch === refreshEpochRef.current) setLoading(false)
    }
  }, [userId])

  const loadMore = async () => {
    if (!cursor || pageRequestRef.current || actionRequestRef.current || safetyBusyId !== null) return
    const requestEpoch = refreshEpochRef.current
    pageRequestRef.current = true
    setLoadingMore(true)
    setError(null)
    try {
      const page = await getMySignalConnectionsPage(cursor)
      if (requestEpoch !== refreshEpochRef.current) return
      setConnections((current) => [...current, ...page.filter((next) =>
        !current.some((item) => item.connectionId === next.connectionId),
      )])
      setHasMore(page.length === SIGNAL_CONNECTION_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? { connectedAt: last.connectedAt, connectionId: last.connectionId } : null)
    } catch (loadError) {
      if (requestEpoch === refreshEpochRef.current) {
        setError(toUserFacingError(loadError, 'Unable to load older connections right now.'))
      }
    } finally {
      pageRequestRef.current = false
      if (requestEpoch === refreshEpochRef.current) setLoadingMore(false)
    }
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    return () => { active = false; refreshEpochRef.current += 1; actionEpochRef.current += 1 }
  }, [refresh])

  const message = async (connection: MySignalConnection) => {
    if (actionRequestRef.current || safetyBusyId !== null) return
    const actionEpoch = actionEpochRef.current
    const requestedUserId = userId
    actionRequestRef.current = true
    setBusyId(connection.connectionId)
    setError(null)
    try {
      const conversationId = await getOrCreateDirectConversation(connection.connectionId)
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      onOpenDirectConversation?.(conversationId)
    } catch (actionError) {
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setError(toUserFacingError(actionError, 'Unable to open a message right now.'))
    } finally {
      actionRequestRef.current = false
      if (actionEpoch === actionEpochRef.current && requestedUserId === userId) setBusyId(null)
    }
  }

  const disconnect = async (connection: MySignalConnection) => {
    if (actionRequestRef.current || safetyBusyId !== null) return
    const actionEpoch = actionEpochRef.current
    const requestedUserId = userId
    actionRequestRef.current = true
    setBusyId(connection.connectionId)
    setError(null)
    try {
      await disconnectMySignalConnection(connection.connectionId)
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      await refresh()
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
    } catch (actionError) {
      if (actionEpoch !== actionEpochRef.current || requestedUserId !== userId) return
      setError(toUserFacingError(actionError, 'Unable to disconnect right now.'))
    } finally {
      actionRequestRef.current = false
      if (actionEpoch === actionEpochRef.current && requestedUserId === userId) setBusyId(null)
    }
  }

  const connectionList = loading ? <p className="profile-connections-empty">Loading connections…</p> : connections.length === 0 ? (
    <div className="profile-connections-empty"><Users size={19} /><span>Connections you make after real SIGNAL meetups will live here.</span></div>
  ) : (
    <div className="profile-connections-list">
      {connections.map((connection) => (
        <div className="profile-connection-person" key={connection.connectionId}>
          {connection.avatarUrl ? <img src={connection.avatarUrl} alt="" /> : <div className="profile-connection-fallback">{connection.displayName.slice(0, 1).toUpperCase()}</div>}
          <button type="button" className="profile-connection-identity" disabled={busyId !== null || safetyBusyId !== null} onClick={() => onOpenProfile?.(connection.userId)}><strong>{connection.displayName}</strong><small>CONNECTED {formatConnectedAt(connection.connectedAt)}</small></button>
          <div className="profile-connection-actions"><button type="button" disabled={busyId !== null || safetyBusyId !== null} onClick={() => { void message(connection) }}><MessageCircle size={13} /> MESSAGE</button><button type="button" disabled={busyId !== null || safetyBusyId !== null} onClick={() => { void disconnect(connection) }}><Unlink size={13} /> DISCONNECT</button></div>
          <UserSafetyActions userId={connection.userId} displayName={connection.displayName} disabled={busyId !== null} onBusyChange={(nextBusy) => setSafetyBusyId(nextBusy ? connection.connectionId : null)} onBlocked={() => { void refresh() }} />
        </div>
      ))}
    </div>
  )

  return (
    <section className="profile-connections-panel">
      <button type="button" className="profile-connections-summary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span><Link2 size={17} /><small>MY CONNECTIONS</small><strong>{connectionCount} {connectionCount === 1 ? 'Connection' : 'Connections'}</strong></span>
        <b>VIEW ALL ›</b>
      </button>
      <p className="profile-connections-summary-copy">People you actually met through SIGNAL.</p>
      {error ? <p className="profile-connections-error" role="alert">{error}</p> : null}

      {open ? <div className="profile-connections-dialog" role="dialog" aria-modal="true" aria-label="My SIGNAL connections" onClick={() => setOpen(false)}>
        <article onClick={(event) => event.stopPropagation()}>
          <header><div><span>⚡ SIGNAL CONNECTIONS</span><h3>My Connections</h3><p>{connectionCount} {connectionCount === 1 ? 'person' : 'people'} you met through SIGNAL.</p></div><button type="button" aria-label="Close connections" onClick={() => setOpen(false)}>×</button></header>
          <div className="profile-connections-dialog-list">
            {connectionList}
            {hasMore ? <button type="button" className="profile-connections-load-more" onClick={() => { void loadMore() }} disabled={loadingMore || busyId !== null || safetyBusyId !== null}>{loadingMore ? 'LOADING…' : 'LOAD OLDER CONNECTIONS'}</button> : null}
          </div>
        </article>
      </div> : null}
    </section>
  )
}
