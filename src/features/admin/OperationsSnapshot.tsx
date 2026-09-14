import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  getAdminOperationsSnapshot,
  type AdminOperationsSnapshot,
} from './adminClient'

const REFRESH_MS = 30_000

export default function OperationsSnapshot() {
  const [snapshot, setSnapshot] = useState<AdminOperationsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)

  const refresh = useCallback(async () => {
    if (mounted.current) setLoading(true)
    try {
      const next = await getAdminOperationsSnapshot()
      if (!mounted.current) return
      setSnapshot(next)
      setError(null)
    } catch (loadError) {
      if (!mounted.current) return
      setError(toUserFacingError(loadError, 'Unable to load operations pressure right now.'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { void refresh() })
    const timer = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [refresh])

  const cards = snapshot ? [
    ['Signals live', snapshot.activeSignalGroups],
    ['Forming', snapshot.formingSignalGroups],
    ['Coordinating', snapshot.coordinatingSignalGroups],
    ['Expiring ≤5m', snapshot.signalsExpiringSoon],
    ['Live Plans', snapshot.livePlans],
    ['People backlog', snapshot.openUserReports],
    ['Moment backlog', snapshot.openMomentReports],
    ['Stale claims', snapshot.staleModerationClaims],
    ['Restricted', snapshot.restrictedAccounts],
  ] as const : []

  return (
    <section className="operations-snapshot" aria-busy={loading}>
      <div className="operations-snapshot-head">
        <div>
          <span>OPERATIONS SNAPSHOT</span>
          <small>{snapshot ? `Updated ${new Date(snapshot.capturedAt).toLocaleTimeString()}` : 'Loading system pressure…'}</small>
        </div>
        <button type="button" onClick={() => { void refresh() }} disabled={loading} aria-label="Refresh operations snapshot">
          <RefreshCw size={15} className={loading ? 'is-spinning' : undefined} />
        </button>
      </div>

      {error ? <p className="operations-snapshot-error" role="alert">{error}</p> : null}

      <div className="operations-snapshot-grid">
        {cards.map(([label, value]) => (
          <article key={label} className={value > 0 && (label === 'Stale claims' || label === 'Expiring ≤5m') ? 'attention' : ''}>
            <span>{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </article>
        ))}
      </div>
    </section>
  )
}
