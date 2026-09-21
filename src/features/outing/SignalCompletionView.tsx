import { useEffect, useRef, useState } from 'react'
import { Check, MapPin, Sparkles, Users, Zap } from 'lucide-react'
import StayConnectedPanel from '../activity/StayConnectedPanel'
import { getMySignalCompletion, submitSignalCompletionFeedback, type SignalCompletion, type SignalCompletionRating } from './signalCompletionClient'
import { toUserFacingError } from '../../lib/userFacingError'
import './SignalCompletionView.css'
import '../activity/ActivityView.css'

type Props = { planId: string; onDone: () => void }

export default function SignalCompletionView({ planId, onDone }: Props) {
  const [summary, setSummary] = useState<SignalCompletion | null>(null)
  const [rating, setRating] = useState<SignalCompletionRating | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const feedbackRequestRef = useRef(false)
  const planEpochRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const planEpoch = ++planEpochRef.current
    feedbackRequestRef.current = false
    void getMySignalCompletion(planId).then((next) => {
      if (!cancelled && planEpoch === planEpochRef.current) { setSummary(next); setRating(next.experienceRating) }
    }).catch((e) => {
      if (!cancelled && planEpoch === planEpochRef.current) setError(toUserFacingError(e, 'Unable to load your completed Signal.'))
    })
    return () => {
      cancelled = true
      planEpochRef.current += 1
    }
  }, [planId])

  const choose = async (next: SignalCompletionRating) => {
    if (feedbackRequestRef.current) return
    const requestPlanId = planId
    const planEpoch = planEpochRef.current
    feedbackRequestRef.current = true
    setSaving(true); setError(null)
    try {
      await submitSignalCompletionFeedback(requestPlanId, next)
      if (requestPlanId === planId && planEpoch === planEpochRef.current) setRating(next)
    } catch (e) {
      if (requestPlanId === planId && planEpoch === planEpochRef.current) {
        setError(toUserFacingError(e, 'Unable to save your feedback.'))
      }
    } finally {
      feedbackRequestRef.current = false
      if (requestPlanId === planId && planEpoch === planEpochRef.current) setSaving(false)
    }
  }

  if (!summary) return <section className="signal-complete-shell"><div className="signal-complete-loading">{error ?? 'Closing out your Signal…'}</div></section>

  return <section className="signal-complete-shell">
    <header className="signal-complete-hero">
      <span><Check size={18}/></span>
      <small>SIGNAL COMPLETE</small>
      <h1>Good night. ⚡</h1>
      <p>This Signal is finished for you. Your Moments and the people you met stay with you.</p>
    </header>

    <section className="signal-complete-receipt">
      <div><Zap size={16}/><span><small>{summary.activityName}</small><strong>{summary.venueName ?? 'SIGNAL meetup'}</strong></span></div>
      <div><MapPin size={16}/><span><small>WHERE YOU MET</small><strong>{summary.cityName}, {summary.stateCode}</strong></span></div>
      <div><Users size={16}/><span><small>YOUR GROUP</small><strong>{summary.participantCount} {summary.participantCount === 1 ? 'person' : 'people'} in this Signal</strong></span></div>
    </section>

    <section className="signal-complete-rating">
      <Sparkles size={20}/>
      <div><small>PRIVATE FEEDBACK</small><h2>How was the Signal?</h2><p>This helps SIGNAL improve future meetups. You're not publicly rating another person.</p></div>
      <div className="signal-complete-rating-actions">
        <button className={rating === 'good' ? 'selected' : ''} disabled={saving} onClick={() => void choose('good')}>👍<strong>GOOD TIME</strong></button>
        <button className={rating === 'okay' ? 'selected' : ''} disabled={saving} onClick={() => void choose('okay')}>😐<strong>IT WAS OK</strong></button>
        <button className={rating === 'bad' ? 'selected' : ''} disabled={saving} onClick={() => void choose('bad')}>👎<strong>NOT GOOD</strong></button>
      </div>
    </section>

    <section className="signal-complete-connect">
      <div><small>PEOPLE YOU MET</small><h2>Stay connected.</h2><p>You can send a connection request as soon as you finish. They can respond whenever they're ready.</p></div>
      {summary.connectionsAvailable ? <StayConnectedPanel planId={planId}/> : null}
    </section>

    {error ? <p className="signal-complete-error" role="alert">{error}</p> : null}
    <button type="button" className="signal-complete-done" disabled={!rating || saving} onClick={onDone}>{rating ? 'DONE' : 'CHOOSE ONE TO FINISH'}</button>
  </section>
}
