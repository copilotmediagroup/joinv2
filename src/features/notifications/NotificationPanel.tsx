import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, MessageCircle, Zap } from 'lucide-react'
import {
  getMyNotificationsPage,
  markMyNotificationRead,
  resolveMyNotificationTarget,
  type NotificationTarget,
  type SignalNotification,
} from './notificationClient'
import './NotificationPanel.css'
import { toUserFacingError } from '../../lib/userFacingError'

type NotificationPanelProps = {
  userId: string
  refreshToken?: number
  totalUnreadCount?: number
  onOpenPlan?: (planId: string) => void
  onOpenSignal?: (target: Extract<NotificationTarget, { targetType: 'signal' }>, notificationType: string) => void
  onHistorical?: (notificationType: string, relatedPlanId: string | null, relatedEntityId: string | null) => void
}

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return 'NOW'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}M`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}H`
  return `${Math.floor(seconds / 86400)}D`
}

export default function NotificationPanel({
  userId,
  refreshToken = 0,
  totalUnreadCount,
  onOpenPlan,
  onOpenSignal,
  onHistorical,
}: NotificationPanelProps) {
  const [items, setItems] = useState<SignalNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refreshEpochRef = useRef(0)

  const unreadCount = useMemo(
    () => items.filter((item) => item.state === 'unread').length,
    [items],
  )


  const refresh = useCallback(async () => {
    const requestEpoch = ++refreshEpochRef.current
    try {
      const page = await getMyNotificationsPage()
      if (requestEpoch !== refreshEpochRef.current) return
      setItems(page.notifications)
      setHasMore(page.hasMore)
      setError(null)
    } catch (loadError) {
      if (requestEpoch !== refreshEpochRef.current) return
      setError(toUserFacingError(loadError, 'Unable to load notifications right now.'))
    } finally {
      if (requestEpoch === refreshEpochRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    return () => { active = false }
  }, [refresh, userId, refreshToken])

  const loadMore = async () => {
    const last = items[items.length - 1]
    if (!last || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await getMyNotificationsPage({ createdAt: last.createdAt, notificationId: last.id })
      setItems((current) => [...current, ...page.notifications])
      setHasMore(page.hasMore)
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load older notifications right now.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const openItem = async (item: SignalNotification) => {
    if (item.state === 'unread') {
      try {
        await markMyNotificationRead(item.id)
        setItems((current) => current.map((entry) =>
          entry.id === item.id ? { ...entry, state: 'read', readAt: new Date().toISOString() } : entry,
        ))
      } catch (markError) {
        setError(toUserFacingError(markError, 'Unable to update this notification right now.'))
      }
    }

    try {
      const target = await resolveMyNotificationTarget(item.id)
      if (target.targetType === 'plan') {
        onOpenPlan?.(target.planId)
      } else if (target.targetType === 'signal') {
        onOpenSignal?.(target, item.type)
      } else {
        onHistorical?.(item.type, item.relatedPlanId, item.relatedEntityId)
      }
    } catch (targetError) {
      setError(toUserFacingError(targetError, 'Unable to open this notification right now.'))
    }
  }

  return (
    <aside className="notification-panel" aria-label="Notifications">
      <header>
        <span><Bell size={15} /> SIGNAL ALERTS</span>
        <strong>{(totalUnreadCount ?? unreadCount) ? `${totalUnreadCount ?? unreadCount} NEW` : 'ALL CAUGHT UP'}</strong>
      </header>

      {error && <p className="notification-error" role="alert">{error}</p>}

      <div className="notification-list">
        {loading ? (
          <div className="notification-empty">Loading alerts…</div>
        ) : items.length === 0 ? (
          <div className="notification-empty">
            <Bell size={24} />
            <strong>No alerts yet</strong>
            <span>SIGNAL updates will show up here.</span>
          </div>
        ) : items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.state === 'unread' ? 'notification-item unread' : 'notification-item'}
            onClick={() => { void openItem(item) }}
          >
            <span className="notification-icon">
              {item.relatedPlanId ? <MessageCircle size={16} /> : <Zap size={16} fill="currentColor" />}
            </span>
            <span className="notification-copy">
              <strong>{item.title}</strong>
              {item.body && <small>{item.body}</small>}
            </span>
            <time>{relativeTime(item.createdAt)}</time>
          </button>
        ))}
        {hasMore ? <button type="button" className="notification-load-more" disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? 'LOADING…' : 'LOAD OLDER ALERTS'}</button> : null}
      </div>
    </aside>
  )
}
