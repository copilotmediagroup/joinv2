import { useCallback, useEffect, useMemo, useState } from 'react'
import { EyeOff, Inbox, RefreshCw, Undo2, XCircle } from 'lucide-react'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  claimNextModerationMoment,
  getModerationMomentEvidence,
  getModerationMomentQueue,
  releaseMyModerationMoment,
  reviewModerationMoment,
  type ModerationAssignmentScope,
  type ModerationMomentEvidenceMedia,
  type ModerationMomentReport,
  type ModerationMomentState,
} from './adminClient'

type QueueTab = 'unassigned' | 'mine' | 'actioned' | 'dismissed'
const PAGE_SIZE = 40

function queueConfig(tab: QueueTab): {
  state: ModerationMomentState
  assignment: ModerationAssignmentScope
} {
  if (tab === 'unassigned') return { state: 'open', assignment: 'unassigned' }
  if (tab === 'mine') return { state: 'reviewed', assignment: 'mine' }
  if (tab === 'actioned') return { state: 'actioned', assignment: 'all' }
  return { state: 'dismissed', assignment: 'all' }
}
function formatReason(reason: string): string {
  return reason.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function MomentModerationPanel() {
  const [tab, setTab] = useState<QueueTab>('unassigned')
  const [items, setItems] = useState<ModerationMomentReport[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState<ModerationMomentEvidenceMedia[]>([])
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  const selected = useMemo(
    () => items.find((item) => item.reportId === selectedId) ?? null,
    [items, selectedId],
  )

  const loadPage = useCallback(async (
    nextTab: QueueTab,
    append = false,
    baseItems: ModerationMomentReport[] = [],
  ) => {
    const config = queueConfig(nextTab)
    const current = append ? baseItems : []
    const cursor = append && current.length > 0
      ? { createdAt: current[current.length - 1].createdAt, reportId: current[current.length - 1].reportId }
      : null

    append ? setLoadingMore(true) : setLoading(true)
    setError(null)
    try {
      const page = await getModerationMomentQueue({ ...config, cursor, limit: PAGE_SIZE })
      const nextItems = append ? [...current, ...page] : page
      setItems(nextItems)
      setHasMore(page.length === PAGE_SIZE)
      if (!append) setSelectedId(nextItems[0]?.reportId ?? null)
    } catch (loadError) {
      setError(toUserFacingError(loadError, 'Unable to load the Moment moderation queue.'))
    } finally {
      append ? setLoadingMore(false) : setLoading(false)
    }
  }, [])

  useEffect(() => {
    setNote('')
    void loadPage(tab)
  }, [loadPage, tab])

  useEffect(() => {
    if (!selected) { setEvidence([]); return }
    let cancelled = false
    setEvidenceLoading(true)
    void getModerationMomentEvidence(selected.reportId)
      .then((rows) => { if (!cancelled) setEvidence(rows) })
      .catch((evidenceError) => {
        if (!cancelled) setError(toUserFacingError(evidenceError, 'Unable to load Moment evidence.'))
      })
      .finally(() => { if (!cancelled) setEvidenceLoading(false) })
    return () => { cancelled = true }
  }, [selected])

  const takeNext = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const claimedId = await claimNextModerationMoment()
      if (!claimedId) {
        setError('No unassigned Moment reports are waiting right now.')
        await loadPage('unassigned')
        return
      }
      const page = await getModerationMomentQueue({
        state: 'reviewed', assignment: 'mine', limit: PAGE_SIZE,
      })
      setTab('mine')
      setItems(page)
      setHasMore(page.length === PAGE_SIZE)
      setSelectedId(page.some((item) => item.reportId === claimedId) ? claimedId : page[0]?.reportId ?? null)
      setNote('')
    } catch (claimError) {
      setError(toUserFacingError(claimError, 'Unable to take the next Moment report.'))
    } finally {
      setActionLoading(false)
    }
  }
  const releaseSelected = async () => {
    if (!selected) return
    setActionLoading(true)
    setError(null)
    try {
      await releaseMyModerationMoment(selected.reportId)
      await loadPage('mine')
      setNote('')
    } catch (releaseError) {
      setError(toUserFacingError(releaseError, 'Unable to release this Moment report.'))
    } finally {
      setActionLoading(false)
    }
  }

  const finishSelected = async (state: 'dismissed' | 'actioned') => {
    if (!selected) return
    setActionLoading(true)
    setError(null)
    try {
      await reviewModerationMoment({
        reportId: selected.reportId,
        state,
        note: note.trim() || null,
      })
      await loadPage('mine')
      setNote('')
    } catch (reviewError) {
      setError(toUserFacingError(reviewError, 'Unable to finish this Moment report.'))
    } finally {
      setActionLoading(false)
    }
  }
  return (
    <div className="moderation-subpanel">
      <div className="moderation-subpanel-heading">
        <div>
          <strong>Moment reports</strong>
          <span>Content review uses the same claimed-case workflow as user safety reports.</span>
        </div>
        <button className="moderation-take-next" onClick={() => { void takeNext() }} disabled={actionLoading}>
          <Inbox size={17} />
          {actionLoading ? 'Working…' : 'Take next Moment'}
        </button>
      </div>

      <div className="moderation-tabs" role="tablist" aria-label="Moment moderation queue">
        {([
          ['unassigned', 'Unassigned'],
          ['mine', 'My queue'],
          ['actioned', 'Actioned'],
          ['dismissed', 'Dismissed'],
        ] as const).map(([value, label]) => (
          <button key={value} className={tab === value ? 'active' : ''}
            onClick={() => { setTab(value); setSelectedId(null) }} role="tab" aria-selected={tab === value}>
            {label}
          </button>
        ))}
        <button className="moderation-refresh" onClick={() => { void loadPage(tab) }} disabled={loading} aria-label="Refresh Moment queue">
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <div className="moderation-error" role="alert">{error}</div>}

      <div className="moderation-workspace">
        <div className="moderation-list" aria-busy={loading}>
          {loading ? (
            <div className="moderation-empty">Loading Moment queue…</div>
          ) : items.length === 0 ? (
            <div className="moderation-empty">No Moment reports in this queue.</div>
          ) : items.map((item) => (
            <button key={item.reportId}
              className={selectedId === item.reportId ? 'moderation-row selected' : 'moderation-row'}
              onClick={() => { setSelectedId(item.reportId); setNote('') }}>
              <span className="moderation-row-topline">
                <strong>{formatReason(item.reason)}</strong>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </span>
              <span className="moderation-row-person">{item.authorDisplayName}</span>
              <span className="moderation-row-details">{item.caption || item.details || 'No caption or additional details.'}</span>
            </button>
          ))}
          {hasMore && (
            <button className="moderation-load-more"
              onClick={() => { void loadPage(tab, true, items) }} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load 40 more'}
            </button>
          )}
        </div>
        <aside className="moderation-detail">
          {!selected ? (
            <div className="moderation-empty">Select a Moment report to review its details.</div>
          ) : (
            <>
              <div className="moderation-detail-header">
                <span className={`moderation-state moderation-state-${selected.state}`}>{selected.state}</span>
                <span>{new Date(selected.createdAt).toLocaleString()}</span>
              </div>
              <div className="moderation-people-grid">
                <div><span>Moment author</span><strong>{selected.authorDisplayName}</strong><small>{selected.authorUserId}</small></div>
                <div><span>Reporter</span><strong>{selected.reporterDisplayName}</strong><small>{selected.reporterUserId}</small></div>
              </div>
              <div className="moderation-case-body">
                <span>Reported content</span>
                <strong>{formatReason(selected.reason)}</strong>
                <p>{selected.caption || 'This Moment has no caption.'}</p>
                {selected.details && <p>{selected.details}</p>}
                <div className="moderation-evidence-grid" aria-busy={evidenceLoading}>
                  {evidenceLoading ? (
                    <div className="moderation-evidence-empty">Loading media evidence…</div>
                  ) : evidence.length === 0 ? (
                    <div className="moderation-evidence-empty">No media is attached to this Moment.</div>
                  ) : evidence.map((media) => media.mediaKind === 'image' ? (
                    <img key={media.storagePath} src={media.url} alt="Reported Moment evidence" />
                  ) : (
                    <video key={media.storagePath} src={media.url} controls preload="metadata" />
                  ))}
                </div>
              </div>
              {selected.state === 'reviewed' && (
                <>
                  <label className="moderation-note-label">Internal review note
                    <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 2000))}
                      placeholder="Record the reason for your content decision…" maxLength={2000} />
                    <span>{note.length}/2000</span>
                  </label>
                  <div className="moderation-actions">
                    <button className="moderation-action resolve" onClick={() => { void finishSelected('actioned') }} disabled={actionLoading}>
                      <EyeOff size={17} /> Hide Moment
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
    </div>
  )
}
