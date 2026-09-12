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

type SignalPlaceStageProps = {
  signalGroupId: string
  signalLabel: string
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

export default function SignalPlaceStage({
  signalGroupId,
  signalLabel,
  onVenueLocked,
}: SignalPlaceStageProps) {
  const [snapshot, setSnapshot] = useState<SignalPlacesResponse | null>(null)
  const [placesLoading, setPlacesLoading] = useState(true)
  const [placesError, setPlacesError] = useState<string | null>(null)
  const [voteSubmitting, setVoteSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const notifiedWinnerId = useRef<string | null>(null)
  const deadlockRestartingRef = useRef(false)
  const deadlockRetryCountRef = useRef(0)

  const loadRound = useCallback(async () => {
    try {
      const next = await fetchSignalPlaces({ signalGroupId, limit: 3 })
      setSnapshot(next)
      setPlacesError(null)
      setSecondsLeft(secondsUntil(next.round.closesAt))
    } catch (error) {
      setPlacesError(
        error instanceof Error
          ? error.message
          : 'Unable to load Signal venues',
      )
    } finally {
      setPlacesLoading(false)
    }
  }, [signalGroupId])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setPlacesLoading(true)
      setPlacesError(null)
      void loadRound()
    })
    return () => { active = false }
  }, [loadRound])

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
            error instanceof Error
              ? error.message
              : 'Unable to finish venue voting',
          )
        }
      })

    return () => { cancelled = true }
  }, [round, secondsLeft, loadRound])

  useEffect(() => {
    deadlockRetryCountRef.current = 0
  }, [signalGroupId])

  useEffect(() => {
    if (!round || round.state !== 'deadlocked') {
      deadlockRestartingRef.current = false
      return
    }
    if (deadlockRestartingRef.current || deadlockRetryCountRef.current >= 1) return

    deadlockRestartingRef.current = true
    deadlockRetryCountRef.current += 1
    setPlacesError(null)
    void restartDeadlockedSignalVenueVote(signalGroupId)
      .then(() => loadRound())
      .catch((error) => {
        deadlockRestartingRef.current = false
        setPlacesError(
          error instanceof Error
            ? error.message
            : 'Unable to restart venue voting',
        )
      })
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

  const castVote = async (optionId: string) => {
    if (!round || round.state !== 'open' || voteSubmitting) return

    setVoteSubmitting(true)
    setPlacesError(null)
    try {
      await castSignalVenueVote(round.id, optionId)
      await loadRound()
    } catch (error) {
      setPlacesError(
        error instanceof Error
          ? error.message
          : 'Unable to cast your venue vote',
      )
    } finally {
      setVoteSubmitting(false)
    }
  }

  if (placesLoading && !snapshot) {
    return (
      <section className="signal-place-stage">
        <p className="signal-place-ranking-copy">
          Finding live venues for this Signal...
        </p>
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

      {placesError && (
        <p className="signal-place-ranking-copy" role="alert">
          {placesError}
        </p>
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
                    <span>{place.distanceMiles.toFixed(1)} mi avg</span><i />
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
                <span>{winner.distanceMiles.toFixed(1)} mi</span>
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
