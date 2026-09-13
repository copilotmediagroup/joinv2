import {
  CalendarClock,
  Camera,
  Clock3,
  MapPin,
  RefreshCw,
  Radio,
  Upload,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityItem } from './activityClient'
import {
  deleteMySignalMoment,
  getMySignalMomentEligiblePlans,
  getSignalMoments,
  publishSignalMoment,
  reportSignalMoment,
  subscribeToSignalMoments,
  type SignalMoment,
  type SignalMomentEligiblePlan,
  type SignalMomentReportReason,
} from './signalMomentsClient'
import './ActivityView.css'
import { toUserFacingError } from '../../lib/userFacingError'

type ActivityViewProps = {
  items: ActivityItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void | Promise<void>
  onOpenItem: (item: ActivityItem) => void
  currentUserId: string
}

function formatState(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase()
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatMomentTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function getPrimaryTime(item: ActivityItem): string | null {
  return formatDateTime(
    item.itemType === 'plan' ? item.scheduledStartsAt : item.startsAt,
  )
}

function getItemLabel(item: ActivityItem): string {
  return item.itemType === 'signal' ? 'CURRENT SIGNAL' : 'CURRENT PLAN'
}function getMembershipLabel(item: ActivityItem): string {
  if (item.itemType === 'signal' && item.isActiveCore) return 'ACTIVE CORE'
  if (item.itemType === 'plan' && item.isActiveCore) return 'LOCKED MEMBER'
  return formatState(item.membershipState)
}

function CurrentActivityCard({
  item,
  onOpen,
}: {
  item: ActivityItem
  onOpen: (item: ActivityItem) => void
}) {
  const primaryTime = getPrimaryTime(item)
  return (
    <motion.article
      className={`activity-card activity-card-${item.itemType}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(item)
        }
      }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.99 }}
    >      <div className="activity-card-rail" aria-hidden="true"><span /></div>
      <div className="activity-card-top">
        <span className="activity-kind">
          {item.itemType === 'signal' ? <Radio size={13} /> : <Zap size={13} fill="currentColor" />}
          {getItemLabel(item)}
        </span>
        <span className="activity-state">{formatState(item.lifecycleState)}</span>
      </div>
      <div className="activity-card-main">
        <div className="activity-bolt" aria-hidden="true">
          <Zap size={18} fill="currentColor" />
        </div>
        <div className="activity-card-copy">
          <h2>{item.activityName}</h2>
          <div className="activity-membership">
            <Users size={14} />
            <span>{getMembershipLabel(item)}</span>
          </div>
        </div>
      </div>
      <div className="activity-card-meta">
        <div>
          {primaryTime ? <Clock3 size={15} /> : <CalendarClock size={15} />}
          <span>{primaryTime ?? 'TIME NOT LOCKED YET'}</span>
        </div>
        <span className="activity-open-hint">OPEN →</span>
      </div>
    </motion.article>
  )
}function MomentCard({
  moment,
  currentUserId,
  onDeleted,
}: {
  moment: SignalMoment
  currentUserId: string
  onDeleted: () => Promise<void>
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] =
    useState<SignalMomentReportReason>('spam')
  const [reportDetails, setReportDetails] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Delete this Signal Moment?')) return
    setDeleting(true)
    setReportStatus(null)
    try {
      await deleteMySignalMoment(moment.momentId)
      await onDeleted()
    } catch (error) {
      setReportStatus(
        toUserFacingError(error, 'Unable to delete this Moment right now.'),
      )
    } finally {
      setDeleting(false)
    }
  }

  const handleReport = async () => {
    setReporting(true)
    setReportStatus(null)
    try {
      await reportSignalMoment({
        momentId: moment.momentId,
        reason: reportReason,
        details: reportDetails,
      })
      setReportStatus('Report received. Thank you.')
      setReportOpen(false)
      setReportDetails('')
    } catch (error) {
      setReportStatus(
        toUserFacingError(error, 'Unable to report this Moment right now.'),
      )
    } finally {
      setReporting(false)
    }
  }

  return (
    <motion.article
      className="signal-moment-card"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="signal-moment-head">
        <div className="signal-moment-author">
          {moment.authorAvatarUrl ? (
            <img src={moment.authorAvatarUrl} alt="" />
          ) : (
            <span>{moment.authorDisplayName.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <strong>{moment.authorDisplayName}</strong>
            <small>{moment.activityName} · {formatMomentTime(moment.publishedAt)}</small>
          </div>
        </div>
        <div className="signal-moment-head-actions">
          {moment.isLocal ? <span className="signal-moment-local">NEAR YOU</span> : null}
          {moment.authorUserId !== currentUserId ? (
            <button type="button" onClick={() => setReportOpen((value) => !value)}>REPORT</button>
          ) : (
            <button type="button" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? 'DELETING…' : 'DELETE'}
            </button>
          )}
        </div>
      </div>

      {reportOpen ? (
        <div className="signal-moment-report-panel">
          <strong>Report this Moment</strong>
          <select
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value as SignalMomentReportReason)}
          >
            <option value="spam">Spam</option>
            <option value="harassment">Harassment</option>
            <option value="hate">Hate or hateful conduct</option>
            <option value="nudity">Nudity or sexual content</option>
            <option value="violence">Violence or threats</option>
            <option value="privacy">Privacy concern</option>
            <option value="other">Other</option>
          </select>
          <textarea
            maxLength={500}
            value={reportDetails}
            placeholder="Optional details"
            onChange={(event) => setReportDetails(event.target.value)}
          />
          <div>
            <button type="button" onClick={() => setReportOpen(false)}>CANCEL</button>
            <button type="button" disabled={reporting} onClick={() => void handleReport()}>
              {reporting ? 'SENDING…' : 'SEND REPORT'}
            </button>
          </div>
        </div>
      ) : null}

      {reportStatus ? <div className="signal-moment-report-status">{reportStatus}</div> : null}

      <div className={`signal-moment-media media-count-${Math.min(moment.media.length, 4)}`}>
        {moment.media.map((media) => (
          media.mediaKind === 'video' ? (
            <video key={media.storagePath} src={media.url} controls playsInline preload="metadata" />
          ) : (
            <img key={media.storagePath} src={media.url} alt="Signal outing moment" />
          )
        ))}
      </div>
      <div className="signal-moment-body">
        {moment.caption ? <p>{moment.caption}</p> : null}
        <div className="signal-moment-proof">
          <span><MapPin size={13} /> {moment.cityName}, {moment.stateCode}</span>
          <span><Users size={13} /> {moment.participantCount} met through SIGNAL</span>
        </div>
      </div>
    </motion.article>
  )
}

function ShareMomentPanel({
  eligiblePlans,
  onPublished,
  onClose,
}: {
  eligiblePlans: SignalMomentEligiblePlan[]
  onPublished: () => Promise<void>
  onClose: () => void
}) {
  const [planId, setPlanId] = useState(eligiblePlans[0]?.planId ?? '')
  const [caption, setCaption] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPlan = useMemo(
    () => eligiblePlans.find((plan) => plan.planId === planId) ?? eligiblePlans[0] ?? null,
    [eligiblePlans, planId],
  )

  const handlePublish = async () => {
    if (!selectedPlan || files.length === 0) return
    setPublishing(true)
    setError(null)
    try {
      await publishSignalMoment({
        planId: selectedPlan.planId,
        caption,
        files,
      })
      await onPublished()
      onClose()
    } catch (publishError) {
      setError(
        toUserFacingError(publishError, 'Unable to publish this Signal Moment right now.'),
      )
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="signal-moment-composer">
      <div className="signal-moment-composer-head">
        <div>
          <span>SHARE A MOMENT</span>
          <strong>Show what actually happened.</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Share a Moment">
          <X size={17} />
        </button>
      </div>      <label className="signal-moment-field">
        <span>OUTING</span>
        <select
          value={selectedPlan?.planId ?? ''}
          onChange={(event) => setPlanId(event.target.value)}
        >
          {eligiblePlans.map((plan) => (
            <option key={plan.planId} value={plan.planId}>
              {plan.activityName} · {plan.cityName}, {plan.stateCode}
            </option>
          ))}
        </select>
      </label>

      <label className="signal-moment-upload">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 6))}
        />
        <span className="signal-moment-upload-icon">
          {files.some((file) => file.type.startsWith('video/')) ? <Video size={22} /> : <Camera size={22} />}
        </span>
        <strong>{files.length > 0 ? `${files.length} selected` : 'Add photos or video'}</strong>
        <small>Up to 6 files · 100 MB each</small>
      </label>

      {files.length > 0 ? (
        <div className="signal-moment-file-list">
          {files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}
        </div>
      ) : null}      <label className="signal-moment-field">
        <span>CAPTION</span>
        <textarea
          value={caption}
          maxLength={500}
          placeholder="What made this one worth remembering?"
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>

      {error ? <div className="signal-moment-error">{error}</div> : null}

      <button
        type="button"
        className="signal-moment-publish"
        disabled={!selectedPlan || files.length === 0 || publishing}
        onClick={() => void handlePublish()}
      >
        <Upload size={15} />
        {publishing ? 'PUBLISHING…' : 'PUBLISH MOMENT'}
      </button>
    </div>
  )
}

export default function ActivityView({
  items,
  loading,
  error,
  onRefresh,
  onOpenItem,
  currentUserId,
}: ActivityViewProps) {
  const currentItem = items[0] ?? null
  const [moments, setMoments] = useState<SignalMoment[]>([])
  const [eligiblePlans, setEligiblePlans] = useState<SignalMomentEligiblePlan[]>([])
  const [momentsLoading, setMomentsLoading] = useState(true)
  const [momentsError, setMomentsError] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)

  const refreshMoments = useCallback(async () => {
    setMomentsLoading(true)
    setMomentsError(null)
    try {
      const [nextMoments, nextEligiblePlans] = await Promise.all([
        getSignalMoments(20),
        getMySignalMomentEligiblePlans(),
      ])
      setMoments(nextMoments)
      setEligiblePlans(nextEligiblePlans)
    } catch (loadError) {
      setMomentsError(
        toUserFacingError(loadError, 'Unable to load Signal Moments right now.'),
      )
    } finally {
      setMomentsLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInitialMoments = async () => {
      try {
        const [nextMoments, nextEligiblePlans] = await Promise.all([
          getSignalMoments(20),
          getMySignalMomentEligiblePlans(),
        ])

        if (!cancelled) {
          setMoments(nextMoments)
          setEligiblePlans(nextEligiblePlans)
        }
      } catch (loadError) {
        if (!cancelled) {
          setMomentsError(
            toUserFacingError(loadError, 'Unable to load Signal Moments right now.'),
          )
        }
      } finally {
        if (!cancelled) {
          setMomentsLoading(false)
        }
      }
    }

    void loadInitialMoments()

    const unsubscribe = subscribeToSignalMoments(() => {
      void refreshMoments()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [refreshMoments])

  return (
    <section className="activity-view">
      <header className="activity-view-header">
        <div>
          <span className="activity-eyebrow">
            <Zap size={13} fill="currentColor" />
            ACTIVITY
          </span>
          <h1>Right now.</h1>
          <p>Your current Signal, then the moments SIGNAL made possible.</p>
        </div>        <button
          type="button"
          className="activity-refresh"
          onClick={() => {
            void onRefresh()
            void refreshMoments()
          }}
          disabled={loading || momentsLoading}
          aria-label="Refresh Activity"
        >
          <RefreshCw
            size={17}
            className={loading || momentsLoading ? 'is-spinning' : undefined}
          />
        </button>
      </header>

      <section className="activity-current-section">
        <div className="activity-section-label">
          <span>YOUR CURRENT SIGNAL</span>
          <small>One place for what you’re part of right now.</small>
        </div>

        {loading && !currentItem ? (
          <div className="activity-status-card">
            <div className="activity-status-bolt"><Zap size={19} fill="currentColor" /></div>
            <strong>CHECKING YOUR SIGNAL…</strong>
            <span>Finding what you’re part of right now.</span>
          </div>
        ) : null}        {error ? (
          <div className="activity-status-card activity-status-error" role="status">
            <strong>ACTIVITY COULDN’T LOAD</strong>
            <span>{error}</span>
            <button type="button" onClick={() => void onRefresh()}>TRY AGAIN</button>
          </div>
        ) : null}

        {!loading && !error && !currentItem ? (
          <div className="activity-status-card activity-status-empty">
            <div className="activity-status-bolt"><Zap size={19} fill="currentColor" /></div>
            <strong>NO ACTIVE SIGNAL YET</strong>
            <span>When you join a Signal or form a Plan, it’ll live here.</span>
          </div>
        ) : null}

        {currentItem ? (
          <CurrentActivityCard item={currentItem} onOpen={onOpenItem} />
        ) : null}
      </section>

      <section className="signal-moments-section">
        <div className="signal-moments-heading">
          <div>
            <span className="activity-section-kicker">SIGNAL MOMENTS</span>
            <h2>People actually went.</h2>
            <p>Photos and videos from real groupings that happened through SIGNAL.</p>
          </div>
          {eligiblePlans.length > 0 && !composerOpen ? (
            <button type="button" className="share-moment-button" onClick={() => setComposerOpen(true)}>
              <Camera size={15} /> SHARE A MOMENT
            </button>
          ) : null}
        </div>        {composerOpen ? (
          <ShareMomentPanel
            eligiblePlans={eligiblePlans}
            onPublished={refreshMoments}
            onClose={() => setComposerOpen(false)}
          />
        ) : null}

        {momentsError ? (
          <div className="signal-moment-feed-status signal-moment-feed-error">
            <strong>MOMENTS COULDN’T LOAD</strong>
            <span>{momentsError}</span>
            <button type="button" onClick={() => void refreshMoments()}>TRY AGAIN</button>
          </div>
        ) : null}

        {momentsLoading && moments.length === 0 ? (
          <div className="signal-moment-feed-status">
            <span className="signal-moment-pulse" />
            <strong>LOADING SIGNAL MOMENTS…</strong>
          </div>
        ) : null}

        {!momentsLoading && !momentsError && moments.length === 0 ? (
          <div className="signal-moment-feed-status signal-moment-feed-empty">
            <div className="signal-moment-empty-icons">
              <Camera size={22} />
              <Video size={22} />
            </div>
            <strong>THE FIRST MOMENT IS COMING.</strong>
            <span>After real SIGNAL outings, member photos and videos will build this timeline.</span>
          </div>
        ) : null}

        {moments.length > 0 ? (
          <div className="signal-moments-feed">
            {moments.map((moment) => (
              <MomentCard
                key={moment.momentId}
                moment={moment}
                currentUserId={currentUserId}
                onDeleted={refreshMoments}
              />
            ))}
          </div>
        ) : null}
      </section>
    </section>
  )
}
