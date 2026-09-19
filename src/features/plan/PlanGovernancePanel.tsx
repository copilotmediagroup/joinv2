import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, LogOut, MapPin, Navigation, ShieldCheck, Users, Zap } from 'lucide-react'
import {
  getMyPlanGovernance,
  getMyPlanReplacementStatus,
  leaveMyPlan,
  proposePlanTimeChange,
  subscribeToPlanGovernance,
  voteOnPlanChange,
  voteOnPlanJoinRequest,
  PlanAccessLostError,
  type PlanGovernanceSnapshot,
  type PlanReplacementStatus,
  type PlanGovernanceVote,
} from './planGovernanceClient'
import './PlanGovernancePanel.css'
import { toUserFacingError } from '../../lib/userFacingError'
import {
  checkInToMyPlan,
  getMyPlanAttendanceStatus,
  type PlanAttendanceStatus,
} from './planAttendanceClient'

type Props = {
  planId: string
  onLeftPlan?: (reason: 'left' | 'ended' | 'safety') => void
  onCheckedIn?: (planId: string) => void
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Not set'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function toLocalInputValue(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 2 * 60 * 60 * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function PlanGovernancePanel({ planId, onLeftPlan, onCheckedIn }: Props) {
  const [snapshot, setSnapshot] = useState<PlanGovernanceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTime, setNewTime] = useState('')
  const [changesFrozen, setChangesFrozen] = useState(true)
  const [replacement, setReplacement] = useState<PlanReplacementStatus | null>(null)
  const [replacementSeconds, setReplacementSeconds] = useState(0)
  const [attendance, setAttendance] = useState<PlanAttendanceStatus | null>(null)
  const [attendanceBusy, setAttendanceBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await getMyPlanGovernance(planId)
      const [replacementStatus, attendanceStatus] = await Promise.all([
        getMyPlanReplacementStatus(planId),
        getMyPlanAttendanceStatus(planId),
      ])
      setSnapshot(next)
      setReplacement(replacementStatus)
      setAttendance(attendanceStatus)
      setReplacementSeconds(
        replacementStatus?.state === 'open'
          ? Math.max(0, Math.ceil((new Date(replacementStatus.deadlineAt).getTime() - Date.now()) / 1000))
          : 0,
      )
      setError(null)
      setChangesFrozen(
        !next.changeFreezeAt ||
        new Date(next.changeFreezeAt).getTime() <= Date.now(),
      )
      setNewTime((current) => current || toLocalInputValue(next.scheduledStartsAt))
    } catch (loadError) {
      if (loadError instanceof PlanAccessLostError) {
        setSnapshot(null)
        setReplacement(null)
        setAttendance(null)
        setError(null)
        onLeftPlan?.('ended')
        return
      }
      setError(toUserFacingError(loadError, 'Unable to load group controls right now.'))
    } finally {
      setLoading(false)
    }
  }, [onLeftPlan, planId])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void refresh() })
    const unsubscribe = subscribeToPlanGovernance(planId, () => {
      if (active) void refresh()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [planId, refresh])


  useEffect(() => {
    if (replacement?.state !== 'open') return
    const timer = window.setInterval(() => {
      setReplacementSeconds(Math.max(0, Math.ceil((new Date(replacement.deadlineAt).getTime() - Date.now()) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [replacement?.deadlineAt, replacement?.state])


  useEffect(() => {
    if (!attendance?.windowOpensAt || !attendance.windowClosesAt) return
    const opensAt = new Date(attendance.windowOpensAt).getTime()
    const closesAt = new Date(attendance.windowClosesAt).getTime()
    const now = Date.now()
    if (now < opensAt || now > closesAt) return

    const refreshAttendance = () => {
      if (document.visibilityState !== 'visible') return
      void getMyPlanAttendanceStatus(planId)
        .then(setAttendance)
        .catch(() => undefined)
    }
    const timer = window.setInterval(refreshAttendance, 10_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAttendance()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [attendance?.windowClosesAt, attendance?.windowOpensAt, planId])

  const checkIn = async () => {
    if (attendanceBusy || !attendance?.canCheckIn) return
    setAttendanceBusy(true)
    setError(null)
    try {
      const nextAttendance = await checkInToMyPlan(planId)
      setAttendance(nextAttendance)
      if (nextAttendance.checkedIn) onCheckedIn?.(planId)
    } catch (checkInError) {
      setError(toUserFacingError(checkInError, 'Unable to check you in right now. Please try again.'))
    } finally {
      setAttendanceBusy(false)
    }
  }

  const runVote = async (
    operation: 'join' | 'change',
    id: string,
    vote: PlanGovernanceVote,
  ) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (operation === 'join') await voteOnPlanJoinRequest(id, vote)
      else await voteOnPlanChange(id, vote)
      await refresh()
    } catch (voteError) {
      setError(toUserFacingError(voteError, 'Your vote did not go through. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const proposeTime = async () => {
    if (busy || !newTime) return
    const parsed = new Date(newTime)
    if (Number.isNaN(parsed.getTime())) {
      setError('Choose a valid meetup time.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await proposePlanTimeChange(planId, parsed.toISOString())
      await refresh()
    } catch (proposalError) {
      setError(toUserFacingError(proposalError, 'Unable to propose that time right now.'))
    } finally {
      setBusy(false)
    }
  }

  const leave = async (reason: 'left' | 'safety' = 'left') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await leaveMyPlan(planId)
      onLeftPlan?.(reason)
    } catch (leaveError) {
      setError(toUserFacingError(leaveError, 'Unable to leave the Plan right now.'))
      setBusy(false)
    }
  }

  if (loading && !snapshot) {
    return <aside className="plan-governance"><span>Loading Plan controls…</span></aside>
  }

  if (!snapshot) {
    return <aside className="plan-governance"><span>{error ?? 'Plan controls unavailable.'}</span></aside>
  }

  const join = snapshot.joinRequest
  const change = snapshot.changeProposal

  return (
    <aside className="plan-governance">
      <header>
        <span><ShieldCheck size={14} /> GROUP CONTROL</span>
        <strong>{snapshot.activeMemberCount}/{snapshot.capacity} IN</strong>
      </header>

      <section className="plan-meetup-card">
        <div className="plan-meetup-copy">
          <span className="plan-governance-kicker"><Zap size={13} fill="currentColor" /> YOUR PLAN IS SET</span>
          <strong>{snapshot.activityName ?? snapshot.title ?? 'SIGNAL PLAN'}</strong>
          <small>{[snapshot.cityName, snapshot.stateCode].filter(Boolean).join(', ')}</small>
        </div>
        <div className="plan-meetup-detail">
          <Clock3 size={15} />
          <span><small>WHEN</small><strong>{formatTime(snapshot.scheduledStartsAt)}</strong></span>
        </div>
        <div className="plan-meetup-detail">
          <MapPin size={15} />
          <span>
            <small>WHERE</small>
            <strong>{snapshot.currentVenueName ?? 'Venue being finalized'}</strong>
            {snapshot.currentVenueAddress && <em>{snapshot.currentVenueAddress}</em>}
          </span>
        </div>
        {snapshot.currentVenueAddress && (
          <a
            className="plan-directions-link"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(snapshot.currentVenueAddress)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Navigation size={14} /> DIRECTIONS
          </a>
        )}

        {attendance?.checkedIn ? (
          <div className="plan-attendance-status checked">
            <CheckCircle2 size={16} />
            <span>
              <small>{attendance.verified ? 'SHOW-UP VERIFIED' : 'CHECKED IN'}</small>
              <strong>{attendance.verified ? 'SIGNAL knows you showed up.' : "You're here."}</strong>
              <em>{attendance.checkedInCount}/{attendance.activeMemberCount} checked in</em>
            </span>
          </div>
        ) : attendance?.canCheckIn ? (
          <button
            type="button"
            className="plan-check-in-button"
            disabled={attendanceBusy}
            onClick={() => { void checkIn() }}
          >
            <MapPin size={15} /> {attendanceBusy ? 'CHECKING YOU IN…' : "I'M HERE"}
          </button>
        ) : attendance?.windowOpensAt && new Date(attendance.windowOpensAt).getTime() > new Date(attendance.serverNow).getTime() ? (
          <div className="plan-attendance-status">
            <MapPin size={15} />
            <span>
              <small>MEETUP CHECK-IN</small>
              <strong>Opens 30 minutes before.</strong>
            </span>
          </div>
        ) : null}
      </section>

      <div className="plan-governance-facts">
        <span><Users size={14} /> {snapshot.activeMemberCount}/{snapshot.capacity} active</span>
        <span>{snapshot.state.replaceAll('_', ' ').toUpperCase()}</span>
      </div>

      {replacement?.state === 'open' && (
        <section className="plan-governance-card">
          <span className="plan-governance-kicker"><Zap size={13} fill="currentColor" /> FINDING A REPLACEMENT</span>
          <strong>We’re keeping this Signal together.</strong>
          <small>
            {replacement.activeMemberCount}/{replacement.requiredActiveCount} ready · {replacementSeconds}s left
          </small>
          <small>A compatible person who goes down for this same Signal can take the open seat automatically.</small>
        </section>
      )}

      {join && (
        <section className="plan-governance-card">
          <span className="plan-governance-kicker"><Zap size={13} fill="currentColor" /> JOIN REQUEST</span>
          <strong>{join.requesterName} wants to join</strong>
          <small>{join.yesVotes} YES · {join.noVotes} NO · {join.majorityRequired} needed</small>
          <div className="plan-governance-actions">
            <button disabled={busy} className={join.myVote === 'yes' ? 'active' : ''} onClick={() => { void runVote('join', join.requestId, 'yes') }}>YES</button>
            <button disabled={busy} className={join.myVote === 'no' ? 'active' : ''} onClick={() => { void runVote('join', join.requestId, 'no') }}>NO</button>
          </div>
        </section>
      )}

      {change && (
        <section className="plan-governance-card">
          <span className="plan-governance-kicker">PLAN CHANGE VOTE</span>
          <strong>
            {change.changeType === 'time'
              ? `Move meetup to ${formatTime(change.proposedStartsAt)}`
              : `Move meetup to ${change.proposedVenueName ?? 'new venue'}`}
          </strong>
          <small>Proposed by {change.proposerName} · {change.yesVotes} YES · {change.noVotes} NO · {change.majorityRequired} needed</small>
          <div className="plan-governance-actions">
            <button disabled={busy} className={change.myVote === 'yes' ? 'active' : ''} onClick={() => { void runVote('change', change.proposalId, 'yes') }}>YES</button>
            <button disabled={busy} className={change.myVote === 'no' ? 'active' : ''} onClick={() => { void runVote('change', change.proposalId, 'no') }}>NO</button>
          </div>
        </section>
      )}

      {!change && (
        <section className="plan-governance-card plan-governance-propose">
          <span className="plan-governance-kicker">PROPOSE A NEW TIME</span>
          <input
            type="datetime-local"
            value={newTime}
            disabled={busy || changesFrozen}
            onChange={(event) => setNewTime(event.target.value)}
          />
          <button type="button" disabled={busy || changesFrozen || !newTime} onClick={() => { void proposeTime() }}>
            {changesFrozen ? 'CHANGES FROZEN' : 'START 5-MIN VOTE'}
          </button>
        </section>
      )}

      {error && <p className="plan-governance-error" role="alert">{error}</p>}

      <div className="plan-governance-exit-actions">
        {attendance?.checkedIn && (
          <button type="button" className="plan-governance-safety-exit" disabled={busy} onClick={() => { void leave('safety') }}>
            <ShieldCheck size={14} /> I DON’T FEEL SAFE — LEAVE NOW
          </button>
        )}
        <button type="button" className="plan-governance-leave" disabled={busy} onClick={() => { void leave('left') }}>
          <LogOut size={14} /> LEAVE SIGNAL
        </button>
      </div>
    </aside>
  )
}
