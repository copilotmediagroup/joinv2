import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Inbox, RefreshCw, ShieldCheck, Undo2, XCircle } from 'lucide-react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  claimNextModerationReport,
  enforceUserAccount,
  getModerationReportQueue,
  getUserAccountEnforcementSummary,
  liftUserAccountRestriction,
  releaseMyModerationReport,
  reviewUserReport,
  type AccountEnforcementSummary,
  type ModerationReport,
  type ModerationReportState,
} from './adminClient'
import './ModerationView.css'

type QueueTab = 'unassigned' | 'mine' | 'resolved' | 'dismissed'

const PAGE_SIZE = 40

function queueConfig(tab: QueueTab): {
  state: ModerationReportState
  assignment: 'all' | 'mine' | 'unassigned'
} {
  if (tab === 'unassigned') return { state: 'open', assignment: 'unassigned' }
  if (tab === 'mine') return { state: 'reviewing', assignment: 'mine' }
  if (tab === 'resolved') return { state: 'resolved', assignment: 'all' }
  return { state: 'dismissed', assignment: 'all' }
}

function formatReason(reason: string): string {
  return reason.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
export default function ModerationView({ canEnforce = false }: { canEnforce?: boolean }) {
  const [tab, setTab] = useState<QueueTab>('unassigned')
  const [items, setItems] = useState<ModerationReport[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [enforcement, setEnforcement] = useState<AccountEnforcementSummary | null>(null)
  const [enforcementLoading, setEnforcementLoading] = useState(false)
  const [enforcementReason, setEnforcementReason] = useState('')
  const [suspensionMinutes, setSuspensionMinutes] = useState(1440)

  const selected = useMemo(
    () => items.find((item) => item.reportId === selectedId) ?? null,
    [items, selectedId],
  )

  const loadPage = useCallback(async (
    nextTab: QueueTab,
    append = false,
    baseItems: ModerationReport[] = [],
  ) => {
    const config = queueConfig(nextTab)
    const current = append ? baseItems : []
    const cursor = append && current.length > 0
      ? { createdAt: current[current.length - 1].createdAt, reportId: current[current.length - 1].reportId }
      : null

    append ? setLoadingMore(true) : setLoading(true)
    setError(null)
    try {
      const page = await getModerationReportQueue({ ...config, cursor, limit: PAGE_SIZE })
      const nextItems = append ? [...current, ...page] : page
      setItems(nextItems)
      setHasMore(page.length === PAGE_SIZE)
      if (!append) setSelectedId(nextItems[0]?.reportId ?? null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load the moderation queue.'))
    } finally {
      append ? setLoadingMore(false) : setLoading(false)
    }
  }, [])
  useEffect(() => {
    setNote('')
    void loadPage(tab)
  }, [loadPage, tab])

  useEffect(() => {
    if (!selected || !canEnforce) { setEnforcement(null); return }
    let cancelled = false
    setEnforcementLoading(true)
    void getUserAccountEnforcementSummary(selected.reportedUserId)
      .then((summary) => { if (!cancelled) setEnforcement(summary) })
      .catch(() => { if (!cancelled) setEnforcement(null) })
      .finally(() => { if (!cancelled) setEnforcementLoading(false) })
    return () => { cancelled = true }
  }, [canEnforce, selected])

  const changeTab = (nextTab: QueueTab) => {
    setTab(nextTab)
    setSelectedId(null)
  }

  const takeNext = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const claimedId = await claimNextModerationReport()
      if (!claimedId) {
        setError('No unassigned reports are waiting right now.')
        await loadPage('unassigned')
        return
      }
      const page = await getModerationReportQueue({
        state: 'reviewing', assignment: 'mine', limit: PAGE_SIZE,
      })
      setTab('mine')
      setItems(page)
      setHasMore(page.length === PAGE_SIZE)
      setSelectedId(page.some((item) => item.reportId === claimedId) ? claimedId : page[0]?.reportId ?? null)
      setNote('')
    } catch (claimError) {
      setError(toUserFacingError(claimError, 'Unable to take the next report.'))
    } finally {
      setActionLoading(false)
    }
  }
  const releaseSelected = async () => {
    if (!selected) return
    setActionLoading(true)
    setError(null)
    try {
      await releaseMyModerationReport(selected.reportId)
      await loadPage('mine')
      setNote('')
    } catch (releaseError) {
      setError(toUserFacingError(releaseError, 'Unable to release this report.'))
    } finally {
      setActionLoading(false)
    }
  }

  const runEnforcement = async (action: 'warning' | 'suspension' | 'ban' | 'lift') => {
    if (!selected || !canEnforce) return
    const reason = enforcementReason.trim()
    if (reason.length < 3) { setError('Enter an enforcement reason before taking action.'); return }
    setActionLoading(true); setError(null)
    try {
      if (action === 'lift') await liftUserAccountRestriction(selected.reportedUserId, reason)
      else await enforceUserAccount({ userId: selected.reportedUserId, action, durationMinutes: action === 'suspension' ? suspensionMinutes : null, reason, sourceReportId: selected.reportId })
      setEnforcement(await getUserAccountEnforcementSummary(selected.reportedUserId))
      setEnforcementReason('')
    } catch (enforceError) { setError(toUserFacingError(enforceError, 'Unable to apply this enforcement action.')) }
    finally { setActionLoading(false) }
  }

  const finishSelected = async (state: 'resolved' | 'dismissed') => {
    if (!selected) return
    setActionLoading(true)
    setError(null)
    try {
      await reviewUserReport({
        reportId: selected.reportId,
        state,
        note: note.trim() || null,
      })
      await loadPage('mine')
      setNote('')
    } catch (reviewError) {
      setError(toUserFacingError(reviewError, 'Unable to finish this report.'))
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <section className="moderation-view">
      <header className="moderation-heading">
        <div>
          <span className="moderation-eyebrow"><ShieldCheck size={14} /> OPERATIONS</span>
          <h1>Safety moderation</h1>
          <p>Claim one case at a time. The shared queue stays available to the rest of the team.</p>
        </div>
        <button className="moderation-take-next" onClick={() => { void takeNext() }} disabled={actionLoading}>
          <Inbox size={17} />
          {actionLoading ? 'Working…' : 'Take next report'}
        </button>
      </header>

      <div className="moderation-tabs" role="tablist" aria-label="Moderation queue">
        {([
          ['unassigned', 'Unassigned'],
          ['mine', 'My queue'],
          ['resolved', 'Resolved'],
          ['dismissed', 'Dismissed'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'active' : ''}
            onClick={() => changeTab(value)}
            role="tab"
            aria-selected={tab === value}
          >
            {label}
          </button>
        ))}
        <button className="moderation-refresh" onClick={() => { void loadPage(tab) }} disabled={loading} aria-label="Refresh queue">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div className="moderation-error" role="alert">{error}</div>}

      <div className="moderation-workspace">
        <div className="moderation-list" aria-busy={loading}>
          {loading ? (
            <div className="moderation-empty">Loading queue…</div>
          ) : items.length === 0 ? (
            <div className="moderation-empty">No reports in this queue.</div>
          ) : (
            items.map((item) => (
              <button
                key={item.reportId}
                className={selectedId === item.reportId ? 'moderation-row selected' : 'moderation-row'}
                onClick={() => { setSelectedId(item.reportId); setNote('') }}
              >
                <span className="moderation-row-topline">
                  <strong>{formatReason(item.reason)}</strong>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </span>
                <span className="moderation-row-person">{item.reportedDisplayName}</span>
                <span className="moderation-row-details">{item.details || 'No additional details provided.'}</span>
              </button>
            ))
          )}

          {hasMore && (
            <button
              className="moderation-load-more"
              onClick={() => { void loadPage(tab, true, items) }}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load 40 more'}
            </button>
          )}
        </div>

        <aside className="moderation-detail">
          {!selected ? (
            <div className="moderation-empty">Select a report to review its details.</div>
          ) : (
            <>
              <div className="moderation-detail-header">
                <span className={`moderation-state moderation-state-${selected.state}`}>{selected.state}</span>
                <span>{new Date(selected.createdAt).toLocaleString()}</span>
              </div>
              <div className="moderation-people-grid">
                <div>
                  <span>Reported user</span>
                  <strong>{selected.reportedDisplayName}</strong>
                  <small>{selected.reportedUserId}</small>
                </div>
                <div>
                  <span>Reporter</span>
                  <strong>{selected.reporterDisplayName}</strong>
                  <small>{selected.reporterUserId}</small>
                </div>
              </div>

              <div className="moderation-case-body">
                {canEnforce && <span>Enforcement authority enabled</span>}
                <span>Reason</span>
                <strong>{formatReason(selected.reason)}</strong>
                <p>{selected.details || 'No additional details were provided.'}</p>
              </div>

              {canEnforce && (
                <section className="moderation-enforcement">
                  <div className="moderation-enforcement-head">
                    <div>
                      <span>Account enforcement</span>
                      <strong>{enforcementLoading ? 'Checking…' : enforcement?.restriction ? enforcement.restriction.toUpperCase() : 'ACTIVE'}</strong>
                    </div>
                    {enforcement?.restrictedUntil && <small>Until {new Date(enforcement.restrictedUntil).toLocaleString()}</small>}
                  </div>
                  {enforcement?.latestAction && (
                    <div className="moderation-enforcement-history">
                      Last action: {enforcement.latestAction} {enforcement.latestActionAt ? '· ' + new Date(enforcement.latestActionAt).toLocaleString() : ''}
                      {enforcement.latestReason ? <span>{enforcement.latestReason}</span> : null}
                    </div>
                  )}
                  <textarea
                    value={enforcementReason}
                    onChange={(event) => setEnforcementReason(event.target.value.slice(0, 2000))}
                    placeholder="Required internal reason for enforcement…"
                    maxLength={2000}
                  />
                  <div className="moderation-enforcement-row">
                    <select value={suspensionMinutes} onChange={(event) => setSuspensionMinutes(Number(event.target.value))}>
                      <option value={60}>1 hour</option>
                      <option value={1440}>24 hours</option>
                      <option value={10080}>7 days</option>
                      <option value={43200}>30 days</option>
                    </select>
                    <button onClick={() => { void runEnforcement('warning') }} disabled={actionLoading}>Warn</button>
                    <button onClick={() => { void runEnforcement('suspension') }} disabled={actionLoading}>Suspend</button>
                    <button className="danger" onClick={() => { void runEnforcement('ban') }} disabled={actionLoading}>Ban</button>
                    {enforcement?.restriction && <button onClick={() => { void runEnforcement('lift') }} disabled={actionLoading}>Lift restriction</button>}
                  </div>
                </section>
              )}
              {selected.state === 'reviewing' && (
                <>
                  <label className="moderation-note-label">
                    Internal review note
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value.slice(0, 2000))}
                      placeholder="Record the reason for your decision…"
                      maxLength={2000}
                    />
                    <span>{note.length}/2000</span>
                  </label>

                  <div className="moderation-actions">
                    <button className="moderation-action resolve" onClick={() => { void finishSelected('resolved') }} disabled={actionLoading}>
                      <CheckCircle2 size={17} /> Resolve
                    </button>
                    <button className="moderation-action dismiss" onClick={() => { void finishSelected('dismissed') }} disabled={actionLoading}>
                      <XCircle size={17} /> Dismiss
                    </button>
                    <button className="moderation-action release" onClick={() => { void releaseSelected() }} disabled={actionLoading}>
                      <Undo2 size={17} /> Release
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
