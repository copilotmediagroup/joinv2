import {
  CalendarClock,
  Camera,
  Clock3,
  MapPin,
  RefreshCw,
  Radio,
  Users,
  Video,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityItem } from './activityClient'
import {
  deleteMySignalMoment,
  getSignalMomentsPage,
  SIGNAL_MOMENT_PAGE_SIZE,
  reportSignalMoment,
  subscribeToSignalMoments,
  type SignalMoment,
  type SignalMomentReportReason,
} from './signalMomentsClient'
import './ActivityView.css'
import { toUserFacingError } from '../../lib/userFacingError'
import StayConnectedPanel from './StayConnectedPanel'
import {
  addMomentComment,
  deleteMyMomentComment,
  getMomentCommentsPage,
  MOMENT_COMMENT_PAGE_SIZE,
  toggleMomentSignal,
  type SignalMomentComment,
} from './signalMomentSocialClient'

type ActivityViewProps = {
  items: ActivityItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void | Promise<void>
  onOpenItem: (item: ActivityItem) => void
  currentUserId: string
  momentComposerPlanId?: string | null
  stayConnectedPlanId?: string | null
  onMomentComposerHandled?: () => void
  focusMomentId?: string | null
  onFocusMomentHandled?: () => void
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
  focused = false,
}: {
  moment: SignalMoment
  currentUserId: string
  onDeleted: () => Promise<void>
  focused?: boolean
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] =
    useState<SignalMomentReportReason>('spam')
  const [reportDetails, setReportDetails] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportStatus, setReportStatus] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [signalOverride, setSignalOverride] = useState<{ baseCount: number; baseSignaled: boolean; count: number; signaled: boolean } | null>(null)
  const [commentOverride, setCommentOverride] = useState<{ baseCount: number; count: number } | null>(null)
  const signaled = signalOverride && signalOverride.baseCount === moment.signalCount && signalOverride.baseSignaled === moment.didSignal ? signalOverride.signaled : moment.didSignal
  const signalCount = signalOverride && signalOverride.baseCount === moment.signalCount && signalOverride.baseSignaled === moment.didSignal ? signalOverride.count : moment.signalCount
  const commentCount = commentOverride && commentOverride.baseCount === moment.commentCount ? commentOverride.count : moment.commentCount
  const [comments, setComments] = useState<SignalMomentComment[]>([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentsHaveMore, setCommentsHaveMore] = useState(false)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [replyTo, setReplyTo] = useState<SignalMomentComment | null>(null)
  const [socialBusy, setSocialBusy] = useState(false)
  const commentsRequestRef = useRef(false)
  const socialMutationRef = useRef(false)
  const deleteRequestRef = useRef(false)
  const reportRequestRef = useRef(false)
  const commentDeleteRequestRef = useRef(false)

  const loadComments = async (loadOlder = false) => {
    if (commentsRequestRef.current) return
    commentsRequestRef.current = true
    setCommentsLoading(true)
    try {
      const oldest = loadOlder ? comments[0] ?? null : null
      const next = await getMomentCommentsPage(
        moment.momentId,
        oldest
          ? { createdAt: oldest.createdAt, commentId: oldest.commentId }
          : null,
      )
      setComments((current) => loadOlder ? [...next, ...current] : next)
      setCommentsHaveMore(next.length === MOMENT_COMMENT_PAGE_SIZE)
    } finally {
      commentsRequestRef.current = false
      setCommentsLoading(false)
    }
  }

  const handleSignal = async () => {
    if (socialMutationRef.current || deleteRequestRef.current || reportRequestRef.current || commentDeleteRequestRef.current) return
    socialMutationRef.current = true
    setSocialBusy(true)
    try {
      const next = await toggleMomentSignal(moment.momentId)
      setSignalOverride({ baseCount: moment.signalCount, baseSignaled: moment.didSignal, count: next.signalCount, signaled: next.signaled })
    } finally { socialMutationRef.current = false; setSocialBusy(false) }
  }

  const handleComment = async () => {
    if (socialMutationRef.current || deleteRequestRef.current || reportRequestRef.current || commentDeleteRequestRef.current || !commentBody.trim()) return
    socialMutationRef.current = true
    setSocialBusy(true)
    try {
      await addMomentComment(moment.momentId, commentBody, replyTo?.commentId ?? null)
      setCommentOverride({ baseCount: moment.commentCount, count: commentCount + 1 })
      setCommentBody('')
      setReplyTo(null)
      await loadComments()
    } finally { socialMutationRef.current = false; setSocialBusy(false) }
  }

  const handleCommentDelete = async (commentId: string) => {
    if (commentDeleteRequestRef.current || socialMutationRef.current || deleteRequestRef.current || reportRequestRef.current) return
    commentDeleteRequestRef.current = true
    try {
      await deleteMyMomentComment(commentId)
      setComments((current) => current.filter((comment) => comment.commentId !== commentId))
      setCommentOverride({ baseCount: moment.commentCount, count: Math.max(0, commentCount - 1) })
      await loadComments()
    } catch (deleteError) {
      setReportStatus(toUserFacingError(deleteError, 'Unable to delete that comment right now.'))
    } finally {
      commentDeleteRequestRef.current = false
    }
  }

  const handleDelete = async () => {
    if (deleteRequestRef.current || socialMutationRef.current || reportRequestRef.current || commentDeleteRequestRef.current || !window.confirm('Delete this Signal Moment?')) return
    deleteRequestRef.current = true
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
      deleteRequestRef.current = false
      setDeleting(false)
    }
  }

  const handleReport = async () => {
    if (reportRequestRef.current || socialMutationRef.current || deleteRequestRef.current || commentDeleteRequestRef.current) return
    reportRequestRef.current = true
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
      reportRequestRef.current = false
      setReporting(false)
    }
  }

  return (
    <motion.article
      className={focused ? "signal-moment-card is-notification-focus" : "signal-moment-card"}
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
            <small>{moment.activityName} · {moment.cityName}, {moment.stateCode}{moment.venueName ? ' ' + moment.venueName : ''}</small><small>{formatMomentTime(moment.publishedAt)}</small>
          </div>
        </div>
        <div className="signal-moment-head-actions">
          {moment.isLocal ? <span className="signal-moment-local">NEAR YOU</span> : null}
          {moment.authorUserId !== currentUserId ? (
            <button type="button" disabled={reporting || socialBusy} onClick={() => setReportOpen((value) => !value)}>REPORT</button>
          ) : (
            <button type="button" disabled={deleting || socialBusy || reporting} onClick={() => void handleDelete()}>
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
            <button type="button" disabled={reporting} onClick={() => setReportOpen(false)}>CANCEL</button>
            <button type="button" disabled={reporting || socialBusy} onClick={() => void handleReport()}>
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
          <span><MapPin size={13} /> {moment.cityName}, {moment.stateCode}{moment.venueName ? ' ' + moment.venueName : ''}</span>
          <span><Users size={13} /> {moment.participantCount} met through SIGNAL</span>
        </div>
        <div className="signal-moment-social">
          <button type="button" className={signaled ? 'is-signaled' : ''} disabled={socialBusy || deleting || reporting} onClick={() => void handleSignal()}><Zap size={17} fill={signaled ? 'currentColor' : 'none'}/> <strong>{signalCount}</strong> SIGNAL{signalCount === 1 ? '' : 'S'}</button>
          <button type="button" onClick={() => { const next=!commentsOpen; setCommentsOpen(next); if(next) void loadComments() }}><span>◯</span> <strong>{commentCount}</strong> COMMENT{commentCount === 1 ? '' : 'S'}</button>
        </div>
        {commentsOpen ? <div className="signal-moment-comments">
          {commentsHaveMore ? <button type="button" className="signal-moment-comments-more" disabled={commentsLoading} onClick={() => void loadComments(true)}>{commentsLoading ? 'LOADING…' : 'LOAD OLDER COMMENTS'}</button> : null}
          {comments.map((comment) => <div key={comment.commentId} className={comment.parentCommentId ? 'signal-moment-comment is-reply' : 'signal-moment-comment'}>
            {comment.authorAvatarUrl ? <img src={comment.authorAvatarUrl} alt=""/> : <i>{comment.authorDisplayName.slice(0,1)}</i>}
            <div><p><strong>{comment.authorDisplayName}</strong> {comment.body}</p><span><button type="button" onClick={() => setReplyTo(comment.parentCommentId ? comments.find((item) => item.commentId === comment.parentCommentId) ?? comment : comment)}>REPLY</button>{comment.isMine ? <button type="button" disabled={socialBusy || deleting || reporting} onClick={() => void handleCommentDelete(comment.commentId)}>DELETE</button> : null}</span></div>
          </div>)}
          {replyTo ? <div className="signal-moment-replying">Replying to {replyTo.authorDisplayName}<button type="button" onClick={() => setReplyTo(null)}>×</button></div> : null}
          <div className="signal-moment-comment-compose"><input maxLength={1000} value={commentBody} placeholder={replyTo ? 'Reply to ' + replyTo.authorDisplayName + '…' : 'Add a comment…'} onChange={(e) => setCommentBody(e.target.value)} onKeyDown={(e) => { if(e.key==='Enter') void handleComment() }}/><button type="button" disabled={socialBusy || deleting || reporting || !commentBody.trim()} onClick={() => void handleComment()}>POST</button></div>
        </div> : null}
      </div>
    </motion.article>
  )
}

export default function ActivityView({
  items,
  loading,
  error,
  onRefresh,
  onOpenItem,
  currentUserId,
  momentComposerPlanId = null,
  stayConnectedPlanId = null,
  focusMomentId = null,
  onFocusMomentHandled,
}: ActivityViewProps) {
  const currentItem = items[0] ?? null
  const [moments, setMoments] = useState<SignalMoment[]>([])
  const [momentsLoading, setMomentsLoading] = useState(true)
  const [momentsLoadingMore, setMomentsLoadingMore] = useState(false)
  const [hasMoreMoments, setHasMoreMoments] = useState(false)
  const [momentsError, setMomentsError] = useState<string | null>(null)
  const momentRealtimeTimerRef = useRef<number | null>(null)
  const momentRefreshPendingRef = useRef(false)
  const momentRefreshEpochRef = useRef(0)

  const refreshMomentFeed = useCallback(async () => {
    const requestEpoch = ++momentRefreshEpochRef.current
    try {
      const nextMoments = await getSignalMomentsPage()
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMoments((current) => {
        const latestIds = new Set(nextMoments.map((moment) => moment.momentId))
        const retainedOlder = current.filter((moment) => !latestIds.has(moment.momentId))
        return [...nextMoments, ...retainedOlder]
      })
      setHasMoreMoments((currentHasMore) =>
        currentHasMore || nextMoments.length === SIGNAL_MOMENT_PAGE_SIZE)
    } catch (loadError) {
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMomentsError(
        toUserFacingError(loadError, 'Unable to refresh Signal Moments right now.'),
      )
    }
  }, [])

  const refreshMoments = useCallback(async () => {
    const requestEpoch = ++momentRefreshEpochRef.current
    setMomentsLoading(true)
    setMomentsError(null)
    try {
      const nextMoments = await getSignalMomentsPage()
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMoments(nextMoments)
      setHasMoreMoments(nextMoments.length === SIGNAL_MOMENT_PAGE_SIZE)
    } catch (loadError) {
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMomentsError(
        toUserFacingError(loadError, 'Unable to load Signal Moments right now.'),
      )
    } finally {
      if (requestEpoch === momentRefreshEpochRef.current) setMomentsLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInitialMoments = async () => {
      const requestEpoch = ++momentRefreshEpochRef.current
      try {
        const nextMoments = await getSignalMomentsPage()
        if (!cancelled && requestEpoch === momentRefreshEpochRef.current) {
          setMoments(nextMoments)
          setHasMoreMoments(nextMoments.length === SIGNAL_MOMENT_PAGE_SIZE)
        }
      } catch (loadError) {
        if (!cancelled && requestEpoch === momentRefreshEpochRef.current) {
          setMomentsError(
            toUserFacingError(loadError, 'Unable to load Signal Moments right now.'),
          )
        }
      } finally {
        if (!cancelled && requestEpoch === momentRefreshEpochRef.current) {
          setMomentsLoading(false)
        }
      }
    }

    void loadInitialMoments()

    const unsubscribe = subscribeToSignalMoments(() => {
      if (document.visibilityState !== 'visible') {
        momentRefreshPendingRef.current = true
        return
      }
      if (momentRealtimeTimerRef.current !== null) {
        window.clearTimeout(momentRealtimeTimerRef.current)
      }

      momentRealtimeTimerRef.current = window.setTimeout(() => {
        momentRealtimeTimerRef.current = null
        if (!cancelled) void refreshMomentFeed()
      }, 500)
    })

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== 'visible'
        || !momentRefreshPendingRef.current
        || cancelled
      ) return
      momentRefreshPendingRef.current = false
      void refreshMomentFeed()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      if (momentRealtimeTimerRef.current !== null) {
        window.clearTimeout(momentRealtimeTimerRef.current)
        momentRealtimeTimerRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      unsubscribe()
    }
  }, [refreshMomentFeed])

  const loadMoreMoments = async () => {
    const last = moments[moments.length - 1]
    if (!last || momentsLoadingMore) return

    const requestEpoch = momentRefreshEpochRef.current
    setMomentsLoadingMore(true)
    setMomentsError(null)
    try {
      const page = await getSignalMomentsPage({
        isLocal: last.isLocal,
        publishedAt: last.publishedAt,
        momentId: last.momentId,
      })
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMoments((current) => {
        const existing = new Set(current.map((moment) => moment.momentId))
        return [...current, ...page.filter((moment) => !existing.has(moment.momentId))]
      })
      setHasMoreMoments(page.length === SIGNAL_MOMENT_PAGE_SIZE)
    } catch (loadError) {
      if (requestEpoch !== momentRefreshEpochRef.current) return
      setMomentsError(toUserFacingError(loadError, 'Unable to load older Signal Moments right now.'))
    } finally {
      if (requestEpoch === momentRefreshEpochRef.current) setMomentsLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!focusMomentId || momentsLoading) return
    const element = document.querySelector('[data-moment-id="' + focusMomentId + '"]')
    if (element instanceof HTMLElement) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); onFocusMomentHandled?.() }
  }, [focusMomentId, moments, momentsLoading, onFocusMomentHandled])

  const connectionPlanId = stayConnectedPlanId ?? momentComposerPlanId ?? null

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
        </div>

        {connectionPlanId ? <StayConnectedPanel key={connectionPlanId} planId={connectionPlanId} /> : null}

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
          <>
            <div className="signal-moments-feed">
              {moments.map((moment) => (
                <div key={moment.momentId} data-moment-id={moment.momentId}>
                  <MomentCard moment={moment} currentUserId={currentUserId} onDeleted={refreshMoments} focused={focusMomentId === moment.momentId} />
                </div>
              ))}
            </div>
            {hasMoreMoments ? (
              <button
                type="button"
                className="signal-moments-load-more"
                onClick={() => { void loadMoreMoments() }}
                disabled={momentsLoadingMore}
              >
                {momentsLoadingMore ? 'LOADING…' : 'LOAD OLDER MOMENTS'}
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  )
}
