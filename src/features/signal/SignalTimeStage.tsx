import {
  useEffect,
  useState,
} from 'react'

import {
  Check,
  Clock3,
  MapPin,
  Zap,
} from 'lucide-react'

import { AnimatePresence, motion } from 'framer-motion'
import './SignalTimeStage.css'
import SignalPlanExperience from '../plan/SignalPlanExperience'
import type {
  SignalPlace,
  SignalPlaceReview,
} from './places/contract'
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
  signalLabel: string
  venue: LockedSignalVenue
  onFindAnotherPlace?: () => void
  onPlanSetChange?: (isPlanSet: boolean) => void
}

type SignalTimeOption = {
  id: string
  time: string
  detail: string
}

const timeResultAvatarUrl = (id: string) =>
'https://i.pravatar.cc/100?img=' + id
const SMART_TIME_LEAD_MINUTES = 30
const SMART_TIME_DURATION_MINUTES = 90
const SMART_TIME_CLOSING_BUFFER_MINUTES = 30
const SMART_TIME_ALIGNMENT_MINUTES = 30

const formatVenueTime = (
  venueMinutes: number,
) => {
  const normalized =
    ((venueMinutes % 1440) + 1440) % 1440

  const hour24 =
    Math.floor(normalized / 60)

  const minute =
    normalized % 60

  const period =
    hour24 >= 12 ? 'PM' : 'AM'

  const hour12 =
    hour24 % 12 || 12

  return (
    hour12 +
    ':' +
    String(minute).padStart(2, '0') +
    ' ' +
    period
  )
}

const alignUp = (
  minutes: number,
  alignment: number,
) =>
  Math.ceil(minutes / alignment) * alignment

const buildSmartTimeOptions = (
  venue: LockedSignalVenue,
): SignalTimeOption[] => {
  if (
    venue.utcOffsetMinutes === null ||
    !venue.openingHours?.periods?.length
  ) {
    return []
  }

  const venueNowMs =
    Date.now() +
    venue.utcOffsetMinutes * 60_000

  const venueNow =
    new Date(venueNowMs)

  const venueDay =
    venueNow.getUTCDay()

  const venueMinute =
    venueNow.getUTCHours() * 60 +
    venueNow.getUTCMinutes()

  const earliestStart =
    alignUp(
      venueMinute + SMART_TIME_LEAD_MINUTES,
      SMART_TIME_ALIGNMENT_MINUTES,
    )

  const candidates: number[] = []

  for (const period of venue.openingHours.periods) {
    if (!period.open) continue

    const openDay =
      period.open.day

    const openMinute =
      period.open.hour * 60 +
      period.open.minute

    let closeMinute =
      period.close
        ? period.close.hour * 60 +
          period.close.minute
        : 1440

    if (
      period.close &&
      (
        period.close.day !== openDay ||
        closeMinute <= openMinute
      )
    ) {
      closeMinute += 1440
    }

    const previousDay =
      (venueDay + 6) % 7

    let relativeOpenMinute: number
    let relativeCloseMinute: number

    if (openDay === venueDay) {
      relativeOpenMinute =
        openMinute

      relativeCloseMinute =
        closeMinute
    } else if (
      openDay === previousDay &&
      closeMinute > 1440
    ) {
      relativeOpenMinute =
        openMinute - 1440

      relativeCloseMinute =
        closeMinute - 1440
    } else {
      continue
    }

    const firstCandidate =
      alignUp(
        Math.max(
          earliestStart,
          relativeOpenMinute,
        ),
        SMART_TIME_ALIGNMENT_MINUTES,
      )

    const latestStart =
      relativeCloseMinute -
      SMART_TIME_DURATION_MINUTES -
      SMART_TIME_CLOSING_BUFFER_MINUTES

    for (
      let candidate = firstCandidate;
      candidate <= latestStart;
      candidate += SMART_TIME_ALIGNMENT_MINUTES
    ) {
      candidates.push(candidate)
    }
  }

  const uniqueCandidates =
    [...new Set(candidates)]
      .sort((a, b) => a - b)
      .slice(0, 3)

  const details =
    uniqueCandidates.length === 1
      ? ['BEST FIT']
      : uniqueCandidates.length === 2
        ? ['EARLIER', 'BEST FIT']
        : ['EARLIER', 'BEST FIT', 'LATER']

  return uniqueCandidates.map(
    (minutes, index) => ({
      id: 'smart-' + minutes,
      time: formatVenueTime(minutes),
      detail: details[index],
    }),
  )
}

type SignalTimeVoter = {
  id: string
  timeId: string
}

const buildGroupTimeVotes = (
  options: SignalTimeOption[],
): SignalTimeVoter[] => {
  if (options.length === 0) return []

  const first =
    options[0]

  const best =
    options[Math.min(1, options.length - 1)]

  const last =
    options[options.length - 1]

  return [
    {
      id: '13',
      timeId: best.id,
    },
    {
      id: '15',
      timeId: best.id,
    },
    {
      id: '17',
      timeId: first.id,
    },
    {
      id: '22',
      timeId: best.id,
    },
    {
      id: '28',
      timeId: last.id,
    },
  ]
}

export default function SignalTimeStage({
  signalLabel,
  venue,
  onFindAnotherPlace,
  onPlanSetChange,
}: SignalTimeStageProps) {
  const timeOptions =
    buildSmartTimeOptions(venue)

  const noUsableTimes =
    timeOptions.length === 0

  const [recoverySeconds, setRecoverySeconds] =
    useState(10)

  const groupTimeVotes =
    buildGroupTimeVotes(timeOptions)

  const [secondsLeft, setSecondsLeft] =
    useState(10)

  const [
    selectedTimeId,
    setSelectedTimeId,
  ] = useState<string | null>(null)

  const [
    lockedTimeId,
    setLockedTimeId,
  ] = useState<string | null>(null)

  useEffect(() => {
    if (secondsLeft <= 0) return

    const timer = window.setTimeout(() => {
      setSecondsLeft((current) =>
        Math.max(0, current - 1)
      )
    }, 1000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [secondsLeft])

  useEffect(() => {
    if (!noUsableTimes) return

    setRecoverySeconds(10)
  }, [
    noUsableTimes,
    venue.placeId,
  ])

  useEffect(() => {
    if (!noUsableTimes) return

    if (recoverySeconds <= 0) {
      onFindAnotherPlace?.()
      return
    }

    const timer =
      window.setTimeout(() => {
        setRecoverySeconds((current) =>
          Math.max(0, current - 1)
        )
      }, 1000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    noUsableTimes,
    recoverySeconds,
    onFindAnotherPlace,
  ])

  const votingClosed = secondsLeft <= 0

  const timeVoteCounts =
    timeOptions.reduce<Record<string, number>>(
      (counts, option) => {
        counts[option.id] =
          groupTimeVotes.filter(
            (vote) =>
              vote.timeId === option.id
          ).length

        if (selectedTimeId === option.id) {
          counts[option.id] += 1
        }

        return counts
      },
      {},
    )

  const winningTimeId =
    timeOptions.reduce(
      (winnerId, option) => {
        if (winnerId === null) {
          return option.id
        }

        const winnerVotes =
          timeVoteCounts[winnerId] ?? 0

        const optionVotes =
          timeVoteCounts[option.id] ?? 0

        return optionVotes > winnerVotes
          ? option.id
          : winnerId
      },
      null as string | null,
    )

  const lockedTime =
    lockedTimeId === null
      ? null
      : timeOptions.find(
          (option) =>
            option.id === lockedTimeId
        ) ?? null

  const reviewSlides =
    venue.reviews
      .filter((review) =>
        review.rating > 0 &&
        review.text.trim().length > 0
      )

  const [planSet, setPlanSet] =
    useState(false)
  const [postPlanView, setPostPlanView] =
    useState<'plan' | 'chat' | null>(null)

  useEffect(() => {
    onPlanSetChange?.(planSet)

    return () => {
      onPlanSetChange?.(false)
    }
  }, [planSet, onPlanSetChange])

  const [reviewIndex, setReviewIndex] =
    useState(0)

  const activeReview =
    reviewSlides.length > 0
      ? reviewSlides[
          reviewIndex % reviewSlides.length
        ]
      : null

  useEffect(() => {
    if (lockedTimeId === null) return
    if (reviewSlides.length <= 1) return

    setReviewIndex(0)

    const timer = window.setInterval(() => {
      setReviewIndex((current) =>
        (current + 1) % reviewSlides.length
      )
    }, 1500)

    return () =>
      window.clearInterval(timer)
  }, [
    lockedTimeId,
    reviewSlides.length,
  ])

  useEffect(() => {
    if (lockedTimeId === null) return

    const timer = window.setTimeout(() => {
      setPlanSet(true)
    }, 5000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [lockedTimeId])

  const resultTimeVoters = [
    ...groupTimeVotes,
    ...(selectedTimeId
      ? [{
          id: '8',
          timeId: selectedTimeId,
        }]
      : []),
].map((vote) => {
const option =      timeOptions.find(
        (item) =>
          item.id === vote.timeId
      )

    return {
      ...vote,
      time:
        option?.time ?? 'NO TIME',
      winner:
        vote.timeId === lockedTimeId,
    }
  })

  useEffect(() => {
    if (!votingClosed) return
    if (lockedTimeId !== null) return
    if (winningTimeId === null) return

    setLockedTimeId(winningTimeId)
  }, [
    votingClosed,
    lockedTimeId,
    winningTimeId,
  ])

  if (planSet && lockedTime && postPlanView) {
    return (
      <SignalPlanExperience
        view={postPlanView}
        signalLabel={signalLabel}
        venueName={venue.name}
        venueAddress={venue.address}
        venuePhotoUrl={venue.photoUrl}
        meetupTime={lockedTime.time}
        onOpenPlan={() => setPostPlanView('plan')}
        onOpenChat={() => setPostPlanView('chat')}
      />
    )
  }

  if (planSet && lockedTime) {
    return (
      <section className="signal-plan-set">
        <div className="signal-plan-set-kicker">
          ⚡ YOUR PLAN IS SET
        </div>

        {venue.photoUrl && (
          <div className="signal-plan-set-photo">
            <img
              src={venue.photoUrl}
              alt={venue.name}
            />
          </div>
        )}

        <h2>{venue.name}</h2>
        <p>{venue.address}</p>

        <div className="signal-plan-set-time">
          <small>MEETUP TIME</small>
          <strong>{lockedTime.time}</strong>
        </div>

        <div className="signal-plan-set-people">
          {['8', '13', '15', '17', '22', '28'].map(
            (id) => (
              <img
                key={id}
                src={timeResultAvatarUrl(id)}
                alt=""
              />
            ),
          )}
        </div>

        <strong className="signal-plan-set-count">
          6 PEOPLE ARE IN
        </strong>

        <button
          type="button"
          className="signal-plan-set-primary"
          onClick={() => setPostPlanView('plan')}
        >
          OPEN PLAN
        </button>

        <button
          type="button"
          className="signal-plan-set-secondary"
          onClick={() => setPostPlanView('chat')}
        >
          OPEN GROUP CHAT
        </button>
      </section>
    )
  }

  return (
    <section className="signal-time-stage">
      <div className="signal-time-title-row">
        <div className="signal-time-title">
          <span>
            <Zap
              size={14}
              fill="currentColor"
            />
            NEXT
          </span>

          <h3>PICK THE TIME</h3>

          <p>
            {votingClosed
              ? 'TIME LOCKING'
              : `CHOOSE YOUR TIME · ${secondsLeft}s`}
          </p>
        </div>

        <div className="signal-time-context">
          {signalLabel}
        </div>
      </div>

      <div className="signal-time-venue">
        <div className="signal-time-venue-icon">
          <MapPin size={16} />
        </div>

        <div>
          <small>VENUE LOCKED</small>
          <strong>{venue.name}</strong>
          <span>{venue.address}</span>
        </div>
      </div>

      {timeOptions.length === 0 ? (
        <div className="signal-time-empty">
          <div className="signal-time-empty-icon">
            <Clock3 size={22} />
          </div>

          <strong>
            {venue.openNow === false
              ? 'THIS BUSINESS IS CLOSED'
              : 'NO TIMES LEFT TONIGHT'}
          </strong>

          <p>
            {venue.openNow === false
              ? `${venue.name} is currently closed. SIGNAL can find an open place for the group.`
              : venue.openNow === true
                ? `${venue.name} is open, but there isn’t enough time remaining for this Signal before closing.`
                : `${venue.name} doesn’t have a usable time remaining for this Signal. SIGNAL can find another place for the group.`}
          </p>

          <button
            type="button"
            className="signal-time-empty-action"
            onClick={onFindAnotherPlace}
          >
            {venue.openNow === false
              ? 'FIND AN OPEN PLACE'
              : 'FIND ANOTHER PLACE'}
          </button>

          <small className="signal-time-recovery-countdown">
            Returning to venue selection in {recoverySeconds}s
          </small>
        </div>
      ) : (
        <div className={
          lockedTime
            ? "signal-time-options signal-time-options-hidden"
            : "signal-time-options"
        }>
        {timeOptions.map((option) => {
          const selected =
            selectedTimeId === option.id

          return (
            <button
              type="button"
              key={option.id}
              disabled={votingClosed}
              className={[
                'signal-time-option',
                selected
                  ? 'signal-time-option-selected'
                  : '',
                lockedTimeId === option.id
                  ? 'signal-time-option-winner'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (votingClosed) return

                setSelectedTimeId(
                  (current) =>
                    current === option.id
                      ? null
                      : option.id
                )
              }}
            >
              <div className="signal-time-option-energy" />

              <div className="signal-time-option-top">
                <Clock3 size={16} />

                <span>
                  {option.detail}
                </span>
              </div>

              <strong>
                {option.time}
              </strong>

              <small>
                {selected
                  ? 'YOUR VOTE'
                  : 'TAP TO VOTE'}
              </small>

              {selected && (
                <>
                  <span className="signal-time-check">
                    <Check size={17} />
                  </span>

                  <span className="signal-time-vote-pulse" />
                </>
              )}
            </button>
          )
        })}
        </div>
      )}

      {lockedTime && (
        <>
          <div className="signal-time-result-grid">
          <motion.div
          className="signal-time-lock-diagnostic"
          data-voter-count={resultTimeVoters.length}
        >
        {venue.photoUrl && (
<div className="signal-time-winner-photo">
<img
src={venue.photoUrl}
alt={venue.name}
/>
<div className="signal-time-winner-photo-shade" />
</div>
)}
<span>⚡ GROUP CHOICE</span>
<strong>{venue.name}</strong>
<small>{venue.address}</small>
<span>WINNING TIME</span>
<strong>{lockedTime.time}</strong>
<small>VENUE + TIME CONFIRMED</small>        </motion.div>
<div className="signal-time-review-stage">
<AnimatePresence mode="wait">
{activeReview && (
<motion.div
key={
  activeReview.authorName +
  reviewIndex
}
className="signal-time-review"
initial={{
  opacity: 0,
  x: 260,
  scale: 0.97,
}}
animate={{
  opacity: 1,
  x: 0,
  scale: 1,
}}
exit={{
  opacity: 0,
  x: -260,
  scale: 0.97,
}}
transition={{
  x: {
    duration: 0.28,
    ease: [0.18, 0.82, 0.22, 1],
  },
  opacity: {
    duration: 0.2,
  },
  scale: {
    duration: 0.28,
  },
}}
>
<div className="signal-time-review-top">
<span>GOOGLE REVIEW</span>

<strong>
{"★".repeat(
  Math.max(
    1,
    Math.min(
      5,
      Math.round(activeReview.rating),
    ),
  ),
)}
</strong>
</div>

<p>
{activeReview.text}
</p>

<div className="signal-time-review-author">
<strong>
{activeReview.authorName ||
  "Google user"}
</strong>

{activeReview.relativeTime && (
<span>
{activeReview.relativeTime}
</span>
)}
</div>
</motion.div>
)}
</AnimatePresence>
</div>

<div className="signal-time-live-rail">
<div className="signal-time-live-rail-heading">
<span>⚡ SIGNAL LIVE</span>
<strong>TIME VOTES</strong>
</div>

<div className="forming-people arrival-list signal-live-rail">
{resultTimeVoters.slice(0, 4).map((voter, index) => (
<motion.div
className="arrival-person pulse-connected signal-live-rail-person"
key={voter.id}
initial={{ opacity: 0, y: 18, scale: 0.97 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
transition={{
delay: 0.22 + index * 0.1,
duration: 0.34,
}}
>
<div className="arrival-avatar-wrap">
<span className="arrival-lock-pulse" />
<img
src={timeResultAvatarUrl(voter.id)}
alt=""
/>
</div>

<span className="signal-live-rail-copy">
<strong>
{voter.winner
? 'VOTED FOR THE WINNER'
: 'VOTED'}
</strong>
<small>{voter.time}</small>
</span>

<span className={
voter.winner
? 'signal-time-vote-status signal-time-vote-status-winner'
: 'signal-time-vote-status'
}>
{voter.winner ? 'WINNER' : 'VOTE'}
</span>
</motion.div>
))}

{resultTimeVoters.length > 4 && (
<motion.div
className="signal-live-rail-overflow signal-time-live-rail-overflow"
initial={{ opacity: 0, y: 10, scale: 0.96 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
transition={{ delay: 0.7, duration: 0.3 }}
>
<div className="signal-live-rail-overflow-avatars">
{resultTimeVoters.slice(4, 7).map((voter) => (
<span
className="signal-live-rail-overflow-avatar"
key={voter.id}
>
<img
src={timeResultAvatarUrl(voter.id)}
alt=""
/>
</span>
))}
</div>
<strong>+{resultTimeVoters.length - 4}</strong>
<span>MORE</span>
</motion.div>
)}
</div>
</div>
          </div>
        </>
      )}

      <div className="signal-time-footer">
        <Zap
          size={14}
          fill="currentColor"
        />

        <span>
          SIGNAL is finding the time that
          works best for the group.
        </span>
      </div>
    </section>
  )
}
