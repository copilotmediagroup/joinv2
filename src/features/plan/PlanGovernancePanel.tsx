import { useCallback, useEffect, useState } from 'react'
import { Clock3, LogOut, ShieldCheck, Users, Zap } from 'lucide-react'
import {
  getMyPlanGovernance,
  leaveMyPlan,
  proposePlanTimeChange,
  subscribeToPlanGovernance,
  voteOnPlanChange,
  voteOnPlanJoinRequest,
  type PlanGovernanceSnapshot,
  type PlanGovernanceVote,
} from './planGovernanceClient'
import './PlanGovernancePanel.css'

type Props = {
  planId: string
  onLeftPlan?: () => void
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

export default function PlanGovernancePanel({ planId, onLeftPlan }: Props) {
  const [snapshot, setSnapshot] = useState<PlanGovernanceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTime, setNewTime] = useState('')
  const [changesFrozen, setChangesFrozen] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const next = await getMyPlanGovernance(planId)
      setSnapshot(next)
      setError(null)
      setChangesFrozen(
        !next.changeFreezeAt ||
        new Date(next.changeFreezeAt).getTime() <= Date.now(),
      )
      setNewTime((current) => current || toLocalInputValue(next.scheduledStartsAt))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Plan controls')
    } finally {
      setLoading(false)
    }
  }, [planId])

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
      setError(voteError instanceof Error ? voteError.message : 'Unable to submit vote')
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
      setError(proposalError instanceof Error ? proposalError.message : 'Unable to propose time')
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await leaveMyPlan(planId)
      onLeftPlan?.()
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : 'Unable to leave Plan')
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

      <div className="plan-governance-facts">
        <span><Clock3 size={14} /> {formatTime(snapshot.scheduledStartsAt)}</span>
        <span><Users size={14} /> {snapshot.activeMemberCount} active members</span>
      </div>

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

      <button type="button" className="plan-governance-leave" disabled={busy} onClick={() => { void leave() }}>
        <LogOut size={14} /> LEAVE PLAN
      </button>
    </aside>
  )
}
