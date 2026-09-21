import { Ban, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  BLOCKED_USERS_PAGE_SIZE,
  getMyBlockedUsersPage,
  unblockUser,
  type BlockedUser,
} from './userSafetyClient'

export default function BlockedPeoplePanel() {
  const [items, setItems] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<{
    blockedAt: string
    blockId: string
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshEpochRef = useRef(0)
  const pageRequestRef = useRef(false)

  const refresh = useCallback(async () => {
    const requestEpoch = ++refreshEpochRef.current
    try {
      setError(null)
      const page = await getMyBlockedUsersPage()
      if (requestEpoch !== refreshEpochRef.current) return
      setItems(page)
      setHasMore(page.length === BLOCKED_USERS_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? {
        blockedAt: last.blockedAt,
        blockId: last.blockId,
      } : null)
    } catch (value) {
      if (requestEpoch !== refreshEpochRef.current) return
      setError(toUserFacingError(
        value,
        'Unable to load blocked people right now.',
      ))
    } finally {
      if (requestEpoch === refreshEpochRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void refresh()
    })
    return () => { active = false }
  }, [refresh])

  const loadMore = async () => {
    if (!cursor || pageRequestRef.current) return
    const requestEpoch = refreshEpochRef.current
    pageRequestRef.current = true
    setLoadingMore(true)
    setError(null)
    try {
      const page = await getMyBlockedUsersPage(cursor)
      if (requestEpoch !== refreshEpochRef.current) return
      setItems((current) => [
        ...current,
        ...page.filter((next) =>
          !current.some((item) => item.blockId === next.blockId),
        ),
      ])
      setHasMore(page.length === BLOCKED_USERS_PAGE_SIZE)
      const last = page[page.length - 1]
      setCursor(last ? {
        blockedAt: last.blockedAt,
        blockId: last.blockId,
      } : null)
    } catch (value) {
      if (requestEpoch === refreshEpochRef.current) {
        setError(toUserFacingError(
          value,
          'Unable to load older blocked people right now.',
        ))
      }
    } finally {
      pageRequestRef.current = false
      if (requestEpoch === refreshEpochRef.current) setLoadingMore(false)
    }
  }

  const unblock = async (user: BlockedUser) => {
    if (busyId) return
    setBusyId(user.userId)
    setError(null)
    try {
      await unblockUser(user.userId)
      refreshEpochRef.current += 1
      setItems((current) =>
        current.filter((item) => item.userId !== user.userId),
      )
    } catch (value) {
      setError(toUserFacingError(
        value,
        'Unable to unblock this person right now.',
      ))
    } finally {
      setBusyId(null)
    }
  }

  if (!loading && items.length === 0 && !error) return null

  return <section className="blocked-people-panel">
    <div className="blocked-people-heading">
      <span><Ban size={14} /> BLOCKED PEOPLE</span>
      <small>People you blocked cannot reconnect or message you.</small>
    </div>
    {loading ? <p>Loading blocked people…</p> : null}
    {error ? <p className="user-safety-error" role="alert">{error}</p> : null}
    <div className="blocked-people-list">
      {items.map((user) => <div key={user.blockId} className="blocked-person-row">
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt="" />
          : <span className="blocked-person-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>}
        <div>
          <strong>{user.displayName}</strong>
          <small>BLOCKED</small>
        </div>
        <button
          type="button"
          disabled={busyId === user.userId}
          onClick={() => { void unblock(user) }}
        >
          <RotateCcw size={13} />
          {busyId === user.userId ? 'UNBLOCKING…' : 'UNBLOCK'}
        </button>
      </div>)}
    </div>
    {hasMore ? (
      <button
        type="button"
        className="blocked-people-load-more"
        onClick={() => { void loadMore() }}
        disabled={loadingMore}
      >
        {loadingMore ? 'LOADING…' : 'LOAD OLDER BLOCKS'}
      </button>
    ) : null}
  </section>
}
