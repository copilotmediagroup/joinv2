import { Link2, MessageCircle, Unlink, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  disconnectMySignalConnection,
  getMySignalConnectionsPage,
  SIGNAL_CONNECTION_PAGE_SIZE,
  type MySignalConnection,
} from '../activity/signalConnectionsClient'
import { getOrCreateDirectConversation } from '../messaging/directMessagingClient'
import UserSafetyActions from '../safety/UserSafetyActions'

function formatConnectedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default function MyConnectionsPanel({ onOpenDirectConversation }: { onOpenDirectConversation?: (conversationId: string) => void }) {
  const [connections, setConnections] = useState<MySignalConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<{ connectedAt: string; connectionId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const page = await getMySignalConnectionsPage()
      setConnections(page)
      setHasMore(page.length === SIGNAL_CONNECTION_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? { connectedAt: last.connectedAt, connectionId: last.connectionId } : null)
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load your connections right now.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await getMySignalConnectionsPage(cursor)
      setConnections((current) => [...current, ...page.filter((next) =>
        !current.some((item) => item.connectionId === next.connectionId),
      )])
      setHasMore(page.length === SIGNAL_CONNECTION_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? { connectedAt: last.connectedAt, connectionId: last.connectionId } : null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load older connections right now.'))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    return () => { active = false }
  }, [refresh])

  const message = async (connection: MySignalConnection) => {
    if (busyId) return
    setBusyId(connection.connectionId)
    setError(null)
    try {
      const conversationId = await getOrCreateDirectConversation(connection.connectionId)
      onOpenDirectConversation?.(conversationId)
    } catch (actionError) {
      setError(toUserFacingError(actionError, 'Unable to open a message right now.'))
    } finally {
      setBusyId(null)
    }
  }

  const disconnect = async (connection: MySignalConnection) => {
    if (busyId) return
    setBusyId(connection.connectionId)
    setError(null)
    try {
      await disconnectMySignalConnection(connection.connectionId)
      await refresh()
    } catch (actionError) {
      setError(toUserFacingError(actionError, 'Unable to disconnect right now.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="profile-connections-panel">
      <div className="profile-view-section-heading">
        <div><span>MY CONNECTIONS</span><h3>People SIGNAL introduced you to</h3></div>
        <Link2 size={17} />
      </div>
      {loading ? <p className="profile-connections-empty">Loading connections…</p> : connections.length === 0 ? (
        <div className="profile-connections-empty"><Users size={19} /><span>Connections you make after real SIGNAL meetups will live here.</span></div>
      ) : (
        <div className="profile-connections-list">
          {connections.map((connection) => (
            <div className="profile-connection-person" key={connection.connectionId}>
              {connection.avatarUrl ? <img src={connection.avatarUrl} alt="" /> : <div className="profile-connection-fallback">{connection.displayName.slice(0, 1).toUpperCase()}</div>}
              <div><strong>{connection.displayName}</strong><small>CONNECTED {formatConnectedAt(connection.connectedAt)}</small></div>
              <div className="profile-connection-actions"><button type="button" disabled={busyId === connection.connectionId} onClick={() => { void message(connection) }}><MessageCircle size={13} /> MESSAGE</button><button type="button" disabled={busyId === connection.connectionId} onClick={() => { void disconnect(connection) }}><Unlink size={13} /> DISCONNECT</button></div>
              <UserSafetyActions userId={connection.userId} displayName={connection.displayName} onBlocked={() => { void refresh() }} />
            </div>
          ))}
        </div>
      )}
      {hasMore ? (
        <button type="button" className="profile-connections-load-more" onClick={() => { void loadMore() }} disabled={loadingMore}>
          {loadingMore ? 'LOADING…' : 'LOAD OLDER CONNECTIONS'}
        </button>
      ) : null}
      {error ? <p className="profile-connections-error" role="alert">{error}</p> : null}
    </section>
  )
}
