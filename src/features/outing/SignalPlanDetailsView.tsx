import { useEffect, useMemo, useState } from 'react'
import { Clock3, MapPin, Navigation, Users, Zap } from 'lucide-react'
import PlanGovernancePanel from '../plan/PlanGovernancePanel'
import { getMyPlanGovernance, type PlanGovernanceSnapshot } from '../plan/planGovernanceClient'
import { getMyPlanMembers, type PlanMemberIdentity } from '../plan/planMembersClient'
import { toUserFacingError } from '../../lib/userFacingError'
import './SignalPlanDetailsView.css'

type Props = {
  planId: string
  onOpenChat: (planId: string) => void
  onCheckedIn: (planId: string) => void
  onPlanEnded: () => void
}

export default function SignalPlanDetailsView({ planId, onCheckedIn, onPlanEnded }: Props) {
  const [plan, setPlan] = useState<PlanGovernanceSnapshot | null>(null)
  const [members, setMembers] = useState<PlanMemberIdentity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [userPosition, setUserPosition] = useState<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getMyPlanGovernance(planId), getMyPlanMembers(planId)])
      .then(([nextPlan, nextMembers]) => {
        if (cancelled) return
        setPlan(nextPlan)
        setMembers(nextMembers)
        setError(null)
      })
      .catch((loadError) => {
        if (!cancelled) setError(toUserFacingError(loadError, 'Unable to load meetup details right now.'))
      })
    return () => { cancelled = true }
  }, [planId])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (position) => setUserPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setUserPosition(null),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const venueMap = useMemo(() => {
    if (!plan || plan.currentVenueLatitude == null || plan.currentVenueLongitude == null) return null
    const lat = Number(plan.currentVenueLatitude), lng = Number(plan.currentVenueLongitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const points = userPosition ? [{ latitude: lat, longitude: lng }, userPosition] : [{ latitude: lat, longitude: lng }]
    const latSpan = Math.max(...points.map((point) => point.latitude)) - Math.min(...points.map((point) => point.latitude))
    const lngSpan = Math.max(...points.map((point) => point.longitude)) - Math.min(...points.map((point) => point.longitude))
    const latPad = Math.max(0.006, latSpan * 0.28)
    const lngPad = Math.max(0.006, lngSpan * 0.28)
    const south = Math.min(...points.map((point) => point.latitude)) - latPad
    const north = Math.max(...points.map((point) => point.latitude)) + latPad
    const west = Math.min(...points.map((point) => point.longitude)) - lngPad
    const east = Math.max(...points.map((point) => point.longitude)) + lngPad
    const userLeft = userPosition ? ((userPosition.longitude - west) / (east - west)) * 100 : null
    const userTop = userPosition ? (1 - (userPosition.latitude - south) / (north - south)) * 100 : null
    return {
      url: `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&amp;layer=mapnik&amp;marker=${lat}%2C${lng}`,
      userLeft,
      userTop,
    }
  }, [plan, userPosition])

  const destinationUrl = useMemo(() => {
    if (!plan) return null
    const q = [plan.currentVenueName, plan.currentVenueAddress, plan.cityName, plan.stateCode].filter(Boolean).join(', ')
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
  }, [plan])

  const meetupTime = useMemo(() => {
    if (!plan?.scheduledStartsAt) return 'Time being finalized'
    const date = new Date(plan.scheduledStartsAt)
    if (Number.isNaN(date.getTime())) return 'Time being finalized'
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
  }, [plan])

  return <section className="signal-details-shell">
    <header className="signal-details-hero">
      <span><Zap size={15} fill="currentColor" /> SIGNAL LIVE · DETAILS</span>
      <h1>{plan?.activityName ?? plan?.title ?? 'YOUR SIGNAL'}</h1>
      <div className="signal-details-summary"><span><Clock3 size={14}/>{meetupTime}</span><span><Users size={14}/>{members.length} going</span></div>
    </header>
    {error && <div className="signal-details-error" role="alert">{error}</div>}
    <section className="signal-details-map-card">
      <div><MapPin size={18}/><span><small>DESTINATION</small><strong>{plan?.currentVenueName ?? 'Meetup venue'}</strong><em>{plan?.currentVenueAddress ?? ''}</em></span></div>
      {venueMap && <div className="signal-details-map-wrap"><iframe title="Signal destination map" src={venueMap.url} loading="lazy" referrerPolicy="no-referrer" />{venueMap.userLeft != null && venueMap.userTop != null && <span className="signal-details-you-marker" style={{ left: `${venueMap.userLeft}%`, top: `${venueMap.userTop}%` }}><i/>YOU</span>}<span className="signal-details-destination-key"><MapPin size={12}/> DESTINATION</span></div>}
      {destinationUrl && <a href={destinationUrl} target="_blank" rel="noreferrer"><Navigation size={15}/> DIRECTIONS</a>}
    </section>
    <section className="signal-details-group">
      <header><span><Users size={15}/> YOUR GROUP</span><strong>{members.length} IN</strong></header>
      <div>{members.map((m) => <span key={m.userId}>{m.avatarUrl ? <img src={m.avatarUrl} alt=""/> : <i>{m.displayName.slice(0,1).toUpperCase()}</i>}<small>{m.isMe ? 'YOU' : m.displayName}</small></span>)}</div>
    </section>
    <PlanGovernancePanel planId={planId} onCheckedIn={onCheckedIn} onLeftPlan={() => onPlanEnded()} />
  </section>
}
