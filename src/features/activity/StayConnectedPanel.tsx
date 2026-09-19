import { Check, UserPlus, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toUserFacingError } from '../../lib/userFacingError'
import { useSignalCurrentUser } from '../onboarding/components/signalCurrentUserContext'
import {
  getCompletedPlanConnections,
  requestSignalConnection,
  respondToSignalConnection,
  subscribeToSignalConnections,
  type SignalConnectionPerson,
} from './signalConnectionsClient'

export default function StayConnectedPanel({ planId }: { planId: string }) {
  const currentUser = useSignalCurrentUser()
  const [people, setPeople] = useState<SignalConnectionPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setPeople(await getCompletedPlanConnections(planId))
      setError(null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load people from this Signal right now.'))
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    return () => { active = false }
  }, [refresh])

  useEffect(() => subscribeToSignalConnections(currentUser.userId, () => { void refresh() }), [currentUser.userId, refresh])

  const connect = async (person: SignalConnectionPerson) => {
    if (busyUserId) return
    setBusyUserId(person.userId)
    setError(null)
    try {
      await requestSignalConnection(planId, person.userId)
      await refresh()
    } catch (actionError) {
      setError(toUserFacingError(actionError, 'Unable to send that connection request right now.'))
    } finally {
      setBusyUserId(null)
    }
  }

  const respond = async (person: SignalConnectionPerson, accept: boolean) => {
    if (busyUserId || !person.connectionId) return
    setBusyUserId(person.userId)
    setError(null)
    try {
      await respondToSignalConnection(person.connectionId, accept)
      await refresh()
    } catch (actionError) {
      setError(toUserFacingError(actionError, 'Unable to update that connection right now.'))
    } finally {
      setBusyUserId(null)
    }
  }

  if (loading) return <section className="stay-connected-panel"><span>Loading people from this Signal…</span></section>
  if (people.length === 0) return <section className="stay-connected-panel"><div className="stay-connected-head"><span><Users size={14} /> STAY CONNECTED</span><small>People appear here after they finish this Signal too.</small></div></section>

  return (
    <section className="stay-connected-panel">
      <div className="stay-connected-head">
        <span><Users size={14} /> STAY CONNECTED</span>
        <small>People you actually met through SIGNAL.</small>
      </div>
      <div className="stay-connected-list">
        {people.map((person) => (
          <div className="stay-connected-person" key={person.userId}>
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <div className="stay-connected-avatar-fallback">{person.displayName.slice(0, 1).toUpperCase()}</div>}
            <div className="stay-connected-copy">
              <strong>{person.displayName}</strong>
              <small>{person.state === 'connected' ? 'CONNECTED' : person.direction === 'outgoing' ? 'REQUEST SENT' : person.direction === 'incoming' ? 'WANTS TO CONNECT' : person.state === 'declined' ? 'DECLINED' : 'FROM THIS SIGNAL'}</small>
            </div>
            {person.state === 'none' ? (
              <button disabled={busyUserId === person.userId} onClick={() => { void connect(person) }}><UserPlus size={13} /> CONNECT</button>
            ) : person.state === 'pending' && person.direction === 'incoming' ? (
              <div className="stay-connected-actions">
                <button disabled={busyUserId === person.userId} onClick={() => { void respond(person, true) }}><Check size={13} /> ACCEPT</button>
                <button disabled={busyUserId === person.userId} onClick={() => { void respond(person, false) }}><X size={13} /> DECLINE</button>
              </div>
            ) : person.state === 'connected' ? <span className="stay-connected-badge"><Check size={13} /> CONNECTED</span> : null}
          </div>
        ))}
      </div>
      {error ? <p className="stay-connected-error" role="alert">{error}</p> : null}
    </section>
  )
}
