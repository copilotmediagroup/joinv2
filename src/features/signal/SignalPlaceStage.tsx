import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion } from 'framer-motion'
import { Check, MapPin, Star, Zap } from 'lucide-react'

import {
  castSignalVenueVote,
  fetchSignalPlaces,
  SignalNoUsableVenueError,
  submitMySignalLocation,
  reconcileSignalVenueRound,
  restartDeadlockedSignalVenueVote,
  subscribeToSignalVenueRound,
} from './places/googlePlacesClient'
import type {
  SignalPlace,
  SignalPlaceReview,
  SignalPlacesResponse,
} from './places/contract'
import './SignalPlaceStage.css'
import { toUserFacingError } from '../../lib/userFacingError'

type SignalPlaceStageProps = {
  signalGroupId: string
  signalLabel: string
  onLeaveSignal?: () => void
  leavingSignal?: boolean
  onVenueLocked?: (venue: {
    placeId: string
    name: string
    address: string
    photoUrl: string | null
    reviews: SignalPlaceReview[]
    openingHours: SignalPlace['openingHours']
    utcOffsetMinutes: SignalPlace['utcOffsetMinutes']
    openNow: SignalPlace['openNow']
  }) => void
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

function venueModeLabel(band: SignalPlace['venueTimeBand']): string | null {
  if (!band) return null
  if (band === 'late_night') return 'LATE NIGHT MODE'
  return `${band.replaceAll('_', ' ').toUpperCase()} MODE`
}

export default function SignalPlaceStage({
  signalGroupId,
  signalLabel,
  onLeaveSignal,
  leavingSignal = false,
  onVenueLocked,
}: SignalPlaceStageProps) {
  const [snapshot, setSnapshot] = useState<SignalPlacesResponse | null>(null)
  const [placesLoading, setPlacesLoading] = useState(true)
  const [placesError, setPlacesError] = useState<string | null>(null)
  const [noUsableVenue, setNoUsableVenue] = useState(false)
  const [voteSubmitting, setVoteSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const notifiedWinnerId = useRef<string | null>(null)
  const voteRequestRef = useRef(false)
  const voteEpochRef = useRef(0)
  const deadlockRestartingRef = useRef(false)
  const deadlockRetryCountRef = useRef(0)
  const locationPreparedRef = useRef(false)
  const roundRequestIdRef = useRef(0)
  const deadlockRestartEpochRef = useRef(0)
  const loadRoundRef = useRef<(() => Promise<void>) | null>(null)

  const prepareLocation = useCallback(() => {
    if (locationPreparedRef.current) return
    locationPreparedRef.current = true
    // Physical GPS is useful venue intelligence, but it must never block the
    // Place screen. Phones can take seconds to wake high-accuracy location.
    void submitMySignalLocation(signalGroupId)
      .then((submitted) => {
        if (submitted) void loadRoundRef.current?.()
      })
      .catch(() => {})
  }, [signalGroupId])

  const loadRound = useCallback(async () => {
    const requestId = ++roundRequestIdRef.current
    try {
      const next = await fetchSignalPlaces({
        signalGroupId,
        limit: 3,
        // Rendering Place must never wait for every phone to deliver GPS.
        // The server uses the midpoint when locations are already available,
        // otherwise city authority opens the round immediately; late GPS can
        // refresh only before a round has been persisted.
        allowCityFallback: true,
      })
      if (requestId !== roundRequestIdRef.current) return
      setSnapshot(next)
      setNoUsableVenue(next.places.length === 0)
      setPlacesError(null)
      setSecondsLeft(secondsUntil(next.round.closesAt))
    } catch (error) {
      if (requestId !== roundRequestIdRef.current) return
      const terminalVenueFailure = error instanceof SignalNoUsableVenueError
      setNoUsableVenue(terminalVenueFailure)
      setPlacesError(
        toUserFacingError(error, 'Unable to load places right now.'),
      )
    } finally {
      if (requestId === roundRequestIdRef.current) setPlacesLoading(false)
    }
  }, [signalGroupId])

  useEffect(() => {
    loadRoundRef.current = loadRound
    return () => {
      if (loadRoundRef.current === loadRound) loadRoundRef.current = null
    }
  }, [loadRound])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setPlacesLoading(true)
      setPlacesError(null)
      prepareLocation()
      void loadRound()
    })
    return () => {
      active = false
      roundRequestIdRef.current += 1
      voteEpochRef.current += 1
    }
  }, [loadRound, prepareLocation])

  useEffect(() => {
    return subscribeToSignalVenueRound(signalGroupId, () => {
      void loadRound()
    })
  }, [signalGroupId, loadRound])

  const round = snapshot?.round ?? null
  const places = useMemo(
    () => snapshot?.places ?? [],
    [snapshot?.places],
  )

  useEffect(() => {
    if (!round || round.state !== 'open') return

    const updateCountdown = () => {
      setSecondsLeft(secondsUntil(round.closesAt))
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [round])

  useEffect(() => {
    if (!round || round.state !== 'open' || secondsLeft > 0) return

    let cancelled = false
    void reconcileSignalVenueRound(round.id)
      .then(() => {
        if (!cancelled) return loadRound()
      })
      .catch((error) => {
        if (!cancelled) {
          setPlacesError(
            toUserFacingError(error, 'Unable to finish the place vote right now.'),
          )
        }
      })

    return () => { cancelled = true }
  }, [round, secondsLeft, loadRound])

  useEffect(() => {
    deadlockRetryCountRef.current = 0
    locationPreparedRef.current = false
  }, [signalGroupId])

  useEffect(() => {
    if (!round || round.state !== 'deadlocked') {
      deadlockRestartingRef.current = false
      return
    }
    if (deadlockRestartingRef.current || deadlockRetryCountRef.current >= 1) return

    const restartEpoch = ++deadlockRestartEpochRef.current
    deadlockRestartingRef.current = true
    deadlockRetryCountRef.current += 1
    setPlacesError(null)
    void restartDeadlockedSignalVenueVote(signalGroupId)
      .then(() => {
        if (restartEpoch !== deadlockRestartEpochRef.current) return
        return loadRound()
      })
      .catch((error) => {
        if (restartEpoch !== deadlockRestartEpochRef.current) return
        deadlockRestartingRef.current = false
        setPlacesError(
          toUserFacingError(error, 'Unable to reopen place voting right now.'),
        )
      })
    return () => { deadlockRestartEpochRef.current += 1 }
  }, [round, signalGroupId, loadRound])

  const winner = useMemo(() => {
    if (!round?.winnerOptionId) return null
    return places.find(
      (place) => place.optionId === round.winnerOptionId,
    ) ?? null
  }, [places, round])

  useEffect(() => {
    if (!round || round.state !== 'won' || !winner || !onVenueLocked) return
    if (notifiedWinnerId.current === winner.optionId) return

    notifiedWinnerId.current = winner.optionId
    // Report the winner immediately. App.tsx owns the visible handoff boundary so
    // realtime/database stage convergence cannot cut the confirmation animation short.
    onVenueLocked({
      placeId: winner.placeId,
      name: winner.name,
      address: winner.address,
      photoUrl: winner.photoUrl,
      reviews: winner.reviews,
      openingHours: winner.openingHours,
      utcOffsetMinutes: winner.utcOffsetMinutes,
      openNow: winner.openNow,
    })
  }, [round, winner, onVenueLocked])

  const totalVotes = round
    ? Object.values(round.voteCounts).reduce((sum, count) => sum + count, 0)
    : 0
  const venueIntelligence = places[0] ?? null
  const modeLabel = venueModeLabel(venueIntelligence?.venueTimeBand)

  const castVote = async (optionId: string) => {
    if (!round || round.state !== 'open' || voteRequestRef.current) return

    const voteEpoch = voteEpochRef.current
    const requestedGroupId = signalGroupId
    const requestedRoundId = round.id
    voteRequestRef.current = true
    setVoteSubmitting(true)
    setPlacesError(null)
    try {
      await castSignalVenueVote(requestedRoundId, optionId)
      if (voteEpoch !== voteEpochRef.current || requestedGroupId !== signalGroupId || requestedRoundId !== round.id) return
      await loadRound()
    } catch (error) {
      if (voteEpoch !== voteEpochRef.current || requestedGroupId !== signalGroupId || requestedRoundId !== round.id) return
      setPlacesError(
        toUserFacingError(error, 'Your place vote did not go through. Try again.'),
      )
    } finally {
      voteRequestRef.current = false
      if (voteEpoch === voteEpochRef.current && requestedGroupId === signalGroupId && requestedRoundId === round.id) setVoteSubmitting(false)
    }
  }

  if (placesLoading && !snapshot) {
    return (
      <section className="signal-place-stage signal-place-searching" aria-live="polite">
        <motion.div
          className="signal-place-search-orbit"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        >
          <span />
        </motion.div>
        <p>Finding the best open meeting point for your group</p>
        <div className="signal-place-search-dots" aria-hidden="true"><i /><i /><i /></div>
      </section>
    )
  }

  return (
    <section className="signal-place-stage">
      <div className="signal-place-title-row">
        <div className="signal-place-title">
          <span><Zap size={14} fill="currentColor" /> NEXT</span>
          <h3>PICK THE PLACE</h3>
          <p className={round?.state === 'won'
            ? 'signal-place-countdown signal-place-countdown-locked'
            : 'signal-place-countdown'}>
            {round?.state === 'won'
              ? 'VENUE LOCKED'
              : round?.state === 'runoff'
                ? 'RUNOFF STARTING...'
                : round?.state === 'deadlocked'
                  ? 'VOTE ENDED'
                  : round
                    ? `${round.roundKind === 'runoff' ? 'RUNOFF' : 'CHOOSE YOUR VENUE'} · ${formatCountdown(secondsLeft)}`
                    : 'VENUE VOTE'}
          </p>
        </div>

        <div className="signal-place-ranking-copy">
          {signalLabel} · {round
            ? `${totalVotes} of ${round.eligibleVoterCount} voted · ${round.majorityRequired} needed to win`
            : 'SIGNAL ranked these for your group'}
        </div>
      </div>

      {venueIntelligence && (
        <div className="signal-venue-intelligence" aria-label="Venue intelligence">
          {modeLabel && <span>{modeLabel}</span>}
          <span>{venueIntelligence.requireOpenNow ? 'OPEN NOW ONLY' : 'OPEN FOR SIGNAL'}</span>
          <span>{venueIntelligence.searchRadiusMiles && venueIntelligence.searchRadiusMiles > 12
            ? `EXPANDED ${venueIntelligence.searchRadiusMiles} MI`
            : 'NEARBY FIRST'}</span>
          <span>
            {venueIntelligence.meetingPointMode === 'group_midpoint'
              ? `GROUP MIDPOINT${venueIntelligence.locationMemberCount && venueIntelligence.activeMemberCount ? ` · ${venueIntelligence.locationMemberCount}/${venueIntelligence.activeMemberCount} LOCATIONS` : ''}`
              : 'CITY CENTER FALLBACK'}
          </span>
        </div>
      )}

      {placesError && (
        <p className="signal-place-ranking-copy" role="alert">
          {placesError}
        </p>
      )}

      {noUsableVenue && (
        <div className="signal-place-empty-exit" role="status">
          <p>There isn't a usable place for this Signal right now.</p>
          {onLeaveSignal && (
            <button type="button" onClick={onLeaveSignal} disabled={leavingSignal}>
              {leavingSignal ? 'ENDING SIGNAL…' : 'END SIGNAL · BACK TO DISCOVER'}
            </button>
          )}
        </div>
      )}

      {round?.state === 'deadlocked' && (
        <p className="signal-place-ranking-copy" role="status">
          The runoff ended without a majority. SIGNAL did not invent a winner.
        </p>
      )}

      {round?.state !== 'won' && places.length > 0 && (
        <div className="signal-place-grid">
          {places.map((place, index) => {
            const selected = round?.currentUserOptionId === place.optionId
            const voteCount = round?.voteCounts[place.optionId] ?? 0
            const leading = places.every(
              (other) => voteCount >= (round?.voteCounts[other.optionId] ?? 0),
            )

            return (
              <button
                type="button"
                key={place.optionId}
                className={[
                  'signal-venue-card',
                  `signal-venue-position-${index + 1}`,
                  index === 0 ? 'signal-venue-featured' : '',
                  leading ? 'signal-venue-leading' : '',
                  selected ? 'signal-venue-selected' : '',
                ].filter(Boolean).join(' ')}
                disabled={round?.state !== 'open' || voteSubmitting}
                onClick={() => { void castVote(place.optionId) }}
              >
                <div className="signal-venue-energy" />
                <div className="signal-venue-image-wrap">
                  {place.photoUrl
                    ? <img src={place.photoUrl} alt="" />
                    : <div className="signal-venue-image-placeholder" />}
                  <span className="signal-venue-rank">
                    {round?.roundKind === 'runoff'
                      ? 'RUNOFF'
                      : place.signalRank === 1
                        ? 'BEST FIT'
                        : `OPTION ${place.signalRank ?? index + 1}`}
                  </span>
                  {selected && (
                    <span className="signal-venue-check"><Check size={18} /></span>
                  )}
                  <div className="signal-venue-image-shade" />
                </div>

                <div className="signal-venue-body">
                  <h4>{place.name}</h4>
                  <div className="signal-venue-address">
                    <MapPin size={13} /><span>{place.address}</span>
                  </div>
                  <div className="signal-venue-facts">
                    <span>{place.signalScore.toFixed(0)} SIGNAL</span><i />
                    <span>{place.groupTravelAverageMiles !== undefined ? `${place.groupTravelAverageMiles.toFixed(1)} mi avg` : `${place.distanceMiles.toFixed(1)} mi from center`}</span><i />
                    <span>{place.category}</span><i />
                    <strong>{place.openNow === true ? 'Open now' : place.openNow === false ? 'Closed' : 'Hours unavailable'}</strong>
                  </div>
                  <div className="signal-venue-bottom">
                    <div className="signal-venue-rating">
                      <Star size={13} fill="currentColor" />
                      <strong>{(place.rating ?? 0).toFixed(1)}</strong>
                      <span>({place.ratingCount})</span>
                    </div>
                    {selected && <span className="signal-you-voted">YOU</span>}
                    <div className="signal-venue-votes">
                      <strong>{voteCount}</strong>
                      <span>{voteCount === 1 ? 'VOTE' : 'VOTES'}</span>
                    </div>
                    <span className="signal-venue-cast"><Zap size={17} fill="currentColor" /></span>
                  </div>
                </div>
                {selected && <div className="signal-vote-pulse" />}
              </button>
            )
          })}
        </div>
      )}

      {round?.state === 'won' && winner && (
        <motion.div
          className="signal-venue-result-stage"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="signal-venue-result-winner">
            <div className="signal-venue-result-energy" />
            <div className="signal-venue-result-image">
              {winner.photoUrl
                ? <img src={winner.photoUrl} alt="" />
                : <div className="signal-venue-image-placeholder" />}
              <div className="signal-venue-image-shade" />
              <span className="signal-venue-result-badge">
                <Zap size={13} fill="currentColor" /> VENUE LOCKED
              </span>
            </div>
            <div className="signal-venue-result-winner-body">
              <h3>{winner.name}</h3>
              <div className="signal-venue-address">
                <MapPin size={13} /><span>{winner.address}</span>
              </div>
              <div className="signal-venue-meta">
                <span><Star size={13} fill="currentColor" />{(winner.rating ?? 0).toFixed(1)}</span>
                <i />
                <span>{winner.groupTravelAverageMiles !== undefined ? `${winner.groupTravelAverageMiles.toFixed(1)} mi avg travel` : `${winner.distanceMiles.toFixed(1)} mi from center`}</span>
                <i />
                <span>{round.voteCounts[winner.optionId] ?? 0} votes</span>
              </div>
            </div>
          </div>
          <div className="signal-venue-result-rail">
            <aside className="signal-venue-result">
              <div className="signal-venue-result-kicker">⚡ GROUP CHOICE</div>
              <h3>{winner.name}</h3>
              <div className="signal-venue-result-summary">
                <strong>{round.voteCounts[winner.optionId] ?? 0}</strong>
                <span>VOTES</span><i />
                <strong>{round.majorityRequired} NEEDED</strong>
              </div>
            </aside>
          </div>
        </motion.div>
      )}

      <div className="signal-place-footer">
        <div>
          <span className="signal-place-footer-icon"><Zap size={15} /></span>
          <p>
            <strong>SIGNAL</strong> keeps this vote authoritative for the entire group.
            <small>Votes can change until a majority locks the venue or the round ends.</small>
          </p>
        </div>
        <strong className="signal-place-action">
          {round?.currentUserOptionId
            ? 'YOUR VOTE IS LIVE'
            : round?.state === 'open'
              ? 'TAP A PLACE TO CAST YOUR VOTE'
              : 'WAITING FOR THE GROUP'}
          <span>›</span>
        </strong>
      </div>
    </section>
  )
}
