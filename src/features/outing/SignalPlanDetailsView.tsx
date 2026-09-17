import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clock3, MapPin, Navigation, Radio, Users, Zap } from 'lucide-react'
import PlanGovernancePanel from '../plan/PlanGovernancePanel'
import { getMyPlanGovernance, type PlanGovernanceSnapshot } from '../plan/planGovernanceClient'
import { getMyPlanMembers, type PlanMemberIdentity } from '../plan/planMembersClient'
import { toUserFacingError } from '../../lib/userFacingError'
import { getMyPlanMemberLocations, setMyPlanLocation, type PlanLiveLocation } from './planLiveLocationClient'
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
  const [liveLocations, setLiveLocations] = useState<PlanLiveLocation[]>([])
  const [planOptionsOpen, setPlanOptionsOpen] = useState(false)

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
    const refreshLocations = () => void getMyPlanMemberLocations(planId).then(setLiveLocations).catch(() => undefined)
    refreshLocations()
    const refreshId = window.setInterval(refreshLocations, 8_000)
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        void setMyPlanLocation(planId, position).then(refreshLocations).catch(() => undefined)
      },
      () => setUserPosition(null),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    )
    return () => { navigator.geolocation.clearWatch(watchId); window.clearInterval(refreshId) }
  }, [planId])

  const venueMap = useMemo(() => {
    if (!plan || plan.currentVenueLatitude == null || plan.currentVenueLongitude == null) return null
    const lat = Number(plan.currentVenueLatitude), lng = Number(plan.currentVenueLongitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const people = liveLocations.length > 0 ? liveLocations : (userPosition ? [{ userId: 'me', displayName: 'YOU', latitude: userPosition.latitude, longitude: userPosition.longitude, accuracyMeters: null, capturedAt: '', isMe: true }] : [])
    const points = [{ latitude: lat, longitude: lng }, ...people]
    const latSpan = Math.max(...points.map((point) => point.latitude)) - Math.min(...points.map((point) => point.latitude))
    const lngSpan = Math.max(...points.map((point) => point.longitude)) - Math.min(...points.map((point) => point.longitude))
    const latPad = Math.max(0.006, latSpan * 0.28), lngPad = Math.max(0.006, lngSpan * 0.28)
    const south = Math.min(...points.map((point) => point.latitude)) - latPad, north = Math.max(...points.map((point) => point.latitude)) + latPad
    const west = Math.min(...points.map((point) => point.longitude)) - lngPad, east = Math.max(...points.map((point) => point.longitude)) + lngPad
    const project = (latitude: number, longitude: number) => ({ left: ((longitude-west)/(east-west))*100, top: (1-(latitude-south)/(north-south))*100 })
    return {
      url: `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&amp;layer=mapnik&amp;marker=${lat}%2C${lng}`,
      people: people.map((person) => ({ ...person, ...project(person.latitude, person.longitude) })),
    }
  }, [plan, userPosition, liveLocations])

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

  const locationStatus = userPosition ? 'LOCATION LIVE' : 'LOCATION WAITING'

  return <section className="signal-details-shell">
    <header className={`signal-details-hero ${plan?.currentVenuePhotoUrl ? 'has-photo' : ''}`} style={plan?.currentVenuePhotoUrl ? { backgroundImage: `linear-gradient(90deg, rgba(4,10,20,.94) 0%, rgba(4,10,20,.72) 52%, rgba(4,10,20,.22) 100%), url("${plan.currentVenuePhotoUrl}")` } : undefined}>
      <div className="signal-details-live-line"><span><i /> LIVE SIGNAL</span><em>{locationStatus}</em></div>
      <div className="signal-details-hero-copy">
        <span className="signal-details-kicker"><Zap size={14} fill="currentColor" /> YOUR NIGHT IS SET</span>
        <h1>{plan?.currentVenueName ?? plan?.activityName ?? plan?.title ?? 'YOUR SIGNAL'}</h1>
        <p>{plan?.currentVenueAddress ?? [plan?.cityName, plan?.stateCode].filter(Boolean).join(', ')}</p>
      </div>
      <div className="signal-details-summary">
        <span><Clock3 size={15}/><strong>{meetupTime}</strong></span>
        <span><Users size={15}/><strong>{members.length} going</strong></span>
      </div>
    </header>
    {error && <div className="signal-details-error" role="alert">{error}</div>}
    <section className="signal-details-journey">
      <header><span><Radio size={14}/> LIVE ROUTE</span><strong>{userPosition ? 'YOU → DESTINATION' : 'DESTINATION READY'}</strong></header>
      {venueMap && <div className="signal-details-map-wrap"><iframe title="Signal destination map" src={venueMap.url} loading="lazy" referrerPolicy="no-referrer" />{venueMap.people.map((person) => { const member = members.find((m) => m.userId === person.userId); return <span key={person.userId} className={`signal-details-person-marker ${person.isMe ? 'is-me' : ''}`} style={{ left: `${person.left}%`, top: `${person.top}%` }}>{member?.avatarUrl ? <img src={member.avatarUrl} alt=""/> : <i/>}<b>{person.isMe ? 'YOU' : person.displayName}</b></span> })}<span className="signal-details-destination-marker"><MapPin size={13}/><b>DESTINATION</b></span></div>}
      <div className="signal-details-destination-strip"><MapPin size={18}/><span><small>MEET HERE</small><strong>{plan?.currentVenueName ?? 'Meetup venue'}</strong><em>{plan?.currentVenueAddress ?? ''}</em></span>{destinationUrl && <a href={destinationUrl} target="_blank" rel="noreferrer"><Navigation size={15}/> DIRECTIONS</a>}</div>
    </section>
    <section className="signal-details-group">
      <header><span><Users size={15}/> YOUR PEOPLE</span><strong>{members.length} LOCKED IN</strong></header>
      <div>{members.map((m) => <span key={m.userId}>{m.avatarUrl ? <img src={m.avatarUrl} alt=""/> : <i>{m.displayName.slice(0,1).toUpperCase()}</i>}<small>{m.isMe ? 'YOU' : m.displayName}</small><em>IN</em></span>)}</div>
    </section>
    <div className={`signal-details-controls ${planOptionsOpen ? 'options-open' : ''}`}>
      <PlanGovernancePanel planId={planId} onCheckedIn={onCheckedIn} onLeftPlan={() => onPlanEnded()} />
    </div>
    <button type="button" className={`signal-details-options-toggle ${planOptionsOpen ? 'open' : ''}`} onClick={() => setPlanOptionsOpen((open) => !open)}><span>PLAN OPTIONS</span><ChevronDown size={16}/></button>
  </section>
}
