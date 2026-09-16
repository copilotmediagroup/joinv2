import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Check,
  Clock3,
  MapPin,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'

import { convertSignalToPlan } from '../plan/signalPlanClient'
import {
  getMyPlanMembers,
  subscribeToPlanMembers,
  type PlanMemberIdentity,
} from '../plan/planMembersClient'
import type {
  SignalPlace,
  SignalPlaceReview,
} from './places/contract'
import {
  fetchSignalTimes,
  reconcileSignalTimeRound,
  recoverSignalVenue,
  submitSignalTimeAvailability,
  subscribeToSignalTimeRound,
} from './time/signalTimeClient'
import type {
  SignalTimeOption,
  SignalTimesResponse,
} from './time/contract'
import './SignalTimeStage.css'
import { toUserFacingError } from '../../lib/userFacingError'

export type LockedSignalVenue = {
  placeId: string
  name: string
  address: string
  photoUrl: string | null
  reviews: SignalPlaceReview[]
  openingHours: SignalPlace['openingHours']
  utcOffsetMinutes: SignalPlace['utcOffsetMinutes']
  openNow: SignalPlace['openNow']
}

type SignalTimeStageProps = {
  signalGroupId: string
  signalLabel: string
  venue: LockedSignalVenue
  onFindAnotherPlace?: () => void
  initialPlanId?: string | null
  onPlanSetChange?: (isPlanSet: boolean) => void
  onOpenPlanChat?: (planId: string) => void
}

function secondsUntil(isoTimestamp: string): number {
  const closesAt = new Date(isoTimestamp).getTime()
  if (!Number.isFinite(closesAt)) return 0
  return Math.max(0, Math.ceil((closesAt - Date.now()) / 1000))
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function displayOptionTime(option: SignalTimeOption): string {
  if (typeof option.displayTime === 'string' && option.displayTime.trim()) {
    return option.displayTime
  }

  const parsed = new Date(option.startsAt)
  if (Number.isNaN(parsed.getTime())) return 'TIME'
  return parsed.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SignalTimeStage({
  signalGroupId,
  signalLabel,
  venue,
  onFindAnotherPlace,
  initialPlanId = null,
  onPlanSetChange,
  onOpenPlanChat,
}: SignalTimeStageProps) {
  const [snapshot, setSnapshot] =
    useState<SignalTimesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [planId, setPlanId] = useState<string | null>(initialPlanId)
  const [planMembers, setPlanMembers] =
    useState<PlanMemberIdentity[]>([])
  const [planCreating, setPlanCreating] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [recoverySeconds, setRecoverySeconds] = useState(10)
  const recoveryStartedRef = useRef(false)
  const recoveryRequiredRef = useRef(false)
  const planConversionStartedRef = useRef(false)
  const snapshotRequestIdRef = useRef(0)

  const loadSnapshot = useCallback(async () => {
    const requestId = ++snapshotRequestIdRef.current

    try {
      let next = await fetchSignalTimes(signalGroupId)

      // A venue winner and its time round can be initialized by different
      // participants almost simultaneously. Never surface a transient
      // no-options response until the authoritative state confirms it.
      if (next.status === 'no_options') {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        if (requestId !== snapshotRequestIdRef.current) return
        next = await fetchSignalTimes(signalGroupId)
      }

      // Realtime, initial load, and post-submit refreshes can overlap. An
      // older response must never overwrite a newer authoritative snapshot.
      if (requestId !== snapshotRequestIdRef.current) return

      setSnapshot(next)
      setError(null)

      if (next.status === 'ready') {
        setSecondsLeft(secondsUntil(next.round.closesAt))
      }
    } catch (loadError) {
      if (requestId !== snapshotRequestIdRef.current) return
      setError(
        toUserFacingError(loadError, 'Unable to coordinate a Signal time right now.'),
      )
    } finally {
      if (requestId === snapshotRequestIdRef.current) setLoading(false)
    }
  }, [signalGroupId])

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (!active) return
      setLoading(true)
      setError(null)
      void loadSnapshot()
    })

    return () => {
      active = false
    }
  }, [loadSnapshot])

  useEffect(() => {
    return subscribeToSignalTimeRound(signalGroupId, () => {
      void loadSnapshot()
    })
  }, [signalGroupId, loadSnapshot])

  const round = snapshot?.status === 'ready'
    ? snapshot.round
    : null

  const options = useMemo(
    () => snapshot?.status === 'ready' ? snapshot.options : [],
    [snapshot],
  )

  const selectedIds = useMemo(
    () => new Set(round?.currentUserAvailableOptionIds ?? []),
    [round?.currentUserAvailableOptionIds],
  )

  const winner = useMemo(() => {
    if (!round?.winnerOptionId) return null
    return options.find(
      (option) => option.optionId === round.winnerOptionId,
    ) ?? null
  }, [options, round])

  useEffect(() => {
    if (!planId) return

    let cancelled = false
    const refreshMembers = async () => {
      try {
        const members = await getMyPlanMembers(planId)
        if (!cancelled) setPlanMembers(members)
      } catch (memberError) {
        if (!cancelled) {
          setPlanError(
            toUserFacingError(memberError, 'Unable to load the group right now.'),
          )
        }
      }
    }

    void refreshMembers()
    const unsubscribe = subscribeToPlanMembers(
      planId,
      () => { void refreshMembers() },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [planId])

  useEffect(() => {
    onPlanSetChange?.(planId !== null)
    return () => onPlanSetChange?.(false)
  }, [onPlanSetChange, planId])

  useEffect(() => {
    if (!round || round.state !== 'open') return

    const tick = () => {
      setSecondsLeft(secondsUntil(round.closesAt))
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [round])

  useEffect(() => {
    if (!round || round.state !== 'open' || secondsLeft > 0) return

    let cancelled = false
    void reconcileSignalTimeRound(round.id)
      .then(() => {
        if (!cancelled) return loadSnapshot()
      })
      .catch((reconcileError) => {
        if (!cancelled) {
          setError(
            toUserFacingError(reconcileError, 'Unable to finish time coordination right now.'),
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [round, secondsLeft, loadSnapshot])

  const recoveryRequired =
    snapshot?.status === 'no_options' ||
    round?.state === 'no_eligible'

  useEffect(() => {
    if (recoveryRequired && !recoveryRequiredRef.current) {
      recoveryStartedRef.current = false
      setRecoverySeconds(10)
    }
    recoveryRequiredRef.current = recoveryRequired
  }, [recoveryRequired])

  const ensurePlan = useCallback(async () => {
    if (planConversionStartedRef.current || planId) return

    planConversionStartedRef.current = true
    setPlanCreating(true)
    setPlanError(null)

    try {
      const result = await convertSignalToPlan(signalGroupId)
      setPlanId(result.planId)
    } catch (conversionError) {
      planConversionStartedRef.current = false
      setPlanError(
        toUserFacingError(conversionError, 'Your Plan is not ready yet. Please try again.'),
      )
    } finally {
      setPlanCreating(false)
    }
  }, [planId, signalGroupId])

  useEffect(() => {
    if (round?.state !== 'won' || !winner || planId) return

    const timer = window.setTimeout(() => {
      void ensurePlan()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [ensurePlan, planId, round?.state, winner])

  const runRecovery = useCallback(async () => {
    if (recovering || recoveryStartedRef.current) return

    recoveryStartedRef.current = true
    setRecovering(true)
    setError(null)

    try {
      await recoverSignalVenue(
        signalGroupId,
        venue.placeId,
        venue.openNow === false
          ? 'closed'
          : 'no_eligible_time',
      )
      onFindAnotherPlace?.()
    } catch (recoveryError) {
      recoveryStartedRef.current = false
      setError(
        toUserFacingError(recoveryError, 'Unable to find another Signal venue right now.'),
      )
    } finally {
      setRecovering(false)
    }
  }, [
    onFindAnotherPlace,
    recovering,
    signalGroupId,
    venue.openNow,
    venue.placeId,
  ])

  useEffect(() => {
    if (!recoveryRequired || recovering) return

    const timer = window.setTimeout(() => {
      if (recoverySeconds <= 0) {
        void runRecovery()
        return
      }

      setRecoverySeconds((current) => Math.max(0, current - 1))
    }, recoverySeconds <= 0 ? 0 : 1000)

    return () => window.clearTimeout(timer)
  }, [recoveryRequired, recovering, recoverySeconds, runRecovery])

  const toggleAvailability = async (optionId: string) => {
    if (!round || round.state !== 'open' || submitting) return

    const next = new Set(selectedIds)
    if (next.has(optionId)) {
      next.delete(optionId)
    } else {
      next.add(optionId)
    }

    setSubmitting(true)
    setError(null)

    try {
      await submitSignalTimeAvailability(
        round.id,
        [...next],
        round.currentUserPreferredOptionId && next.has(round.currentUserPreferredOptionId)
          ? round.currentUserPreferredOptionId
          : null,
      )
      await loadSnapshot()
    } catch (submitError) {
      setError(
        toUserFacingError(submitError, 'Unable to submit your available times right now.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const choosePreference = async (optionId: string) => {
    if (!round || round.state !== 'open' || submitting) return

    const nextAvailable = new Set(selectedIds)
    nextAvailable.add(optionId)
    const nextPreferred =
      round.currentUserPreferredOptionId === optionId
        ? null
        : optionId

    setSubmitting(true)
    setError(null)

    try {
      await submitSignalTimeAvailability(
        round.id,
        [...nextAvailable],
        nextPreferred,
      )
      await loadSnapshot()
    } catch (submitError) {
      setError(
        toUserFacingError(submitError, 'Unable to save your preferred time right now.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !snapshot) {
    return (
      <section className="signal-time-stage signal-time-searching" aria-live="polite">
        <motion.div
          className="signal-time-search-orbit"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        >
          <span />
        </motion.div>
        <p>Building the group’s live time window</p>
        <div className="signal-time-search-dots" aria-hidden="true"><i /><i /><i /></div>
      </section>
    )
  }

  if (recoveryRequired) {
    return (
      <section className="signal-time-stage">
        <div className="signal-time-venue">
          <div className="signal-time-venue-icon"><MapPin size={16} /></div>
          <div>
            <small>VENUE CHECK</small>
            <strong>{venue.name}</strong>
            <span>{venue.address}</span>
          </div>
        </div>

        <div className="signal-time-empty">
          <div className="signal-time-empty-icon"><Clock3 size={22} /></div>
          <strong>
            {venue.openNow === false
              ? 'THIS BUSINESS IS CLOSED'
              : 'NO GROUP TIME WORKS HERE'}
          </strong>
          <p>
            {venue.openNow === false
              ? `${venue.name} is currently closed. SIGNAL will move the group to a fresh venue vote.`
              : 'This venue does not have an eligible meetup time for enough active Signal members.'}
          </p>
          <button
            type="button"
            className="signal-time-empty-action"
            disabled={recovering}
            onClick={() => { void runRecovery() }}
          >
            {recovering ? 'FINDING ANOTHER PLACE...' : 'FIND ANOTHER PLACE'}
          </button>
          <small className="signal-time-recovery-countdown">
            {recovering
              ? 'Refreshing venue selection…'
              : `Returning to venue selection in ${recoverySeconds}s`}
          </small>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>
    )
  }

  if (!round) {
    return (
      <section className="signal-time-stage">
        <p className="signal-time-context" role="alert">
          {error ?? 'Time coordination is unavailable.'}
        </p>
      </section>
    )
  }

  return (
    <section className="signal-time-stage">
      <div className="signal-time-title-row">
        <div className="signal-time-title">
          <span><Zap size={14} fill="currentColor" /> NEXT</span>
          <h3>PICK THE TIME</h3>
          <p>
            {round.state === 'won'
              ? 'TIME LOCKED'
              : `MARK EVERY TIME THAT WORKS · ${formatCountdown(secondsLeft)}`}
          </p>
        </div>
        <div className="signal-time-context">
          {signalLabel} · {round.respondedParticipantCount}/{round.eligibleParticipantCount} RESPONDED
        </div>
      </div>

      <div className="signal-time-venue">
        <div className="signal-time-venue-icon"><MapPin size={16} /></div>
        <div>
          <small>VENUE LOCKED</small>
          <strong>{venue.name}</strong>
          <span>{venue.address}</span>
        </div>
      </div>

      {error && (
        <p className="signal-time-context" role="alert">{error}</p>
      )}

      {round.state === 'open' && (
        <div className="signal-time-options">
          {options.map((option) => {
            const selected = selectedIds.has(option.optionId)
            const preferred = round.currentUserPreferredOptionId === option.optionId
            const availableCount = round.availableCounts[option.optionId] ?? 0

            return (
              <button
                type="button"
                key={option.optionId}
                disabled={submitting}
                className={[
                  'signal-time-option',
                  selected ? 'signal-time-option-selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => { void toggleAvailability(option.optionId) }}
              >
                <div className="signal-time-option-energy" />
                <div className="signal-time-option-top">
                  <Clock3 size={16} />
                  <span>{option.label}</span>
                </div>
                <strong>{displayOptionTime(option)}</strong>
                <small>
                  {selected
                    ? `AVAILABLE · ${availableCount} IN`
                    : `${availableCount} AVAILABLE · TAP IF YOU CAN MAKE IT`}
                </small>
                {selected && (
                  <>
                    <span className="signal-time-check"><Check size={17} /></span>
                    <span className="signal-time-vote-pulse" />
                    <button
                      type="button"
                      className="signal-time-preference-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void choosePreference(option.optionId)
                      }}
                    >
                      {preferred ? '★ PREFERRED' : '☆ PREFER'}
                    </button>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}

      {round.state === 'won' && winner && (
        <motion.div
          className="signal-time-result-grid"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="signal-time-lock-diagnostic">
            {venue.photoUrl && (
              <div className="signal-time-winner-photo">
                <img src={venue.photoUrl} alt={venue.name} />
                <div className="signal-time-winner-photo-shade" />
              </div>
            )}
            <span>⚡ GROUP TIME LOCKED</span>
            <strong>{venue.name}</strong>
            <small>{venue.address}</small>
            <span>MEETUP TIME</span>
            <strong>{displayOptionTime(winner)}</strong>
            <small>
              {round.availableCounts[winner.optionId] ?? 0} ACTIVE MEMBERS CAN MAKE IT
            </small>
          </div>

          <div className="signal-time-live-rail">
            <div className="signal-time-live-rail-heading">
              <span>⚡ {planId ? 'PLAN SET' : 'SIGNAL LIVE'}</span>
              <strong>
                {planId
                  ? 'YOUR PLAN IS SET'
                  : planCreating
                    ? 'CREATING PLAN...'
                    : 'AVAILABILITY'}
              </strong>
            </div>
            {planError && (
              <p className="signal-time-context" role="alert">{planError}</p>
            )}
            {planId && onOpenPlanChat && (
              <button
                type="button"
                className="signal-time-open-chat"
                onClick={() => onOpenPlanChat(planId)}
              >
                OPEN GROUP CHAT
              </button>
            )}
            <div className="forming-people arrival-list signal-live-rail">
              {planId && planMembers.length > 0
                ? planMembers.map((member) => (
                    <div
                      className="arrival-person pulse-connected signal-live-rail-person"
                      key={member.userId}
                    >
                      <div className="arrival-avatar-wrap">
                        <span className="arrival-lock-pulse" />
                        {member.avatarUrl ? (
                          <img
                            className="signal-time-member-avatar"
                            src={member.avatarUrl}
                            alt=""
                          />
                        ) : (
                          <span className="aligned-avatar" aria-hidden="true">
                            {member.displayName.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="signal-live-rail-copy">
                        <strong>{member.isMe ? 'YOU' : member.displayName}</strong>
                        <small>LOCKED IN</small>
                      </span>
                      <span className="signal-time-vote-status signal-time-vote-status-winner">
                        IN
                      </span>
                    </div>
                  ))
                : options.map((option) => (
                    <div
                      className="arrival-person pulse-connected signal-live-rail-person"
                      key={option.optionId}
                    >
                      <div className="arrival-avatar-wrap">
                        <span className="arrival-lock-pulse" />
                        <span className="aligned-avatar" aria-hidden="true">⚡</span>
                      </div>
                      <span className="signal-live-rail-copy">
                        <strong>{displayOptionTime(option)}</strong>
                        <small>
                          {round.availableCounts[option.optionId] ?? 0} available
                          {round.preferredCounts[option.optionId]
                            ? ` · ${round.preferredCounts[option.optionId]} prefer`
                            : ''}
                        </small>
                      </span>
                      <span className={
                        option.optionId === winner.optionId
                          ? 'signal-time-vote-status signal-time-vote-status-winner'
                          : 'signal-time-vote-status'
                      }>
                        {option.optionId === winner.optionId ? 'WINNER' : 'TIME'}
                      </span>
                    </div>
                  ))}
            </div>
          </div>
        </motion.div>
      )}

      <div className="signal-time-footer">
        <Zap size={14} fill="currentColor" />
        <span>
          SIGNAL chooses the time that works for the most active members, then preference, then earliest practical time.
        </span>
      </div>
    </section>
  )
}
