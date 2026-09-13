import { Ban, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  getMyBlockedUsers,
  unblockUser,
  type BlockedUser,
} from './userSafetyClient'

export default function BlockedPeoplePanel() {
  const [items, setItems] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      setItems(await getMyBlockedUsers())
    } catch (value) {
      setError(toUserFacingError(value, 'Unable to load blocked people right now.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    return () => { active = false }
  }, [refresh])

  const unblock = async (user: BlockedUser) => {
    if (busyId) return
    setBusyId(user.userId)
    setError(null)
    try {
      await unblockUser(user.userId)
      setItems((current) => current.filter((item) => item.userId !== user.userId))
    } catch (value) {
      setError(toUserFacingError(value, 'Unable to unblock this person right now.'))
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
  </section>
}
