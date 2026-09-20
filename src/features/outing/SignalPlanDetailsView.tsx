import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clock3, MapPin, Navigation, Radio, Users, Zap } from 'lucide-react'
import PlanGovernancePanel from '../plan/PlanGovernancePanel'
import { getMyPlanGovernance, subscribeToPlanGovernance, type PlanGovernanceSnapshot } from '../plan/planGovernanceClient'
import { getMyPlanMembers, type PlanMemberIdentity } from '../plan/planMembersClient'
import { checkInToMyPlan, getMyPlanAttendanceStatus, type PlanAttendanceStatus } from '../plan/planAttendanceClient'
import { toUserFacingError } from '../../lib/userFacingError'
import { getMyPlanMemberLocations, setMyPlanLocation, type PlanLiveLocation } from './planLiveLocationClient'
import SignalLiveMap from './SignalLiveMap'
import { getSignalRoute, type SignalRoute } from './signalRouteClient'
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
  const [attendance, setAttendance] = useState<PlanAttendanceStatus | null>(null)
  const [attendanceBusy, setAttendanceBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userPosition, setUserPosition] = useState<{ latitude: number; longitude: number } | null>(null)
  const [liveLocations, setLiveLocations] = useState<PlanLiveLocation[]>([])
  const [planOptionsOpen, setPlanOptionsOpen] = useState(false)
  const [planOptionsMounted, setPlanOptionsMounted] = useState(false)
  const [route, setRoute] = useState<SignalRoute | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const lastLocationPublishRef = useRef<{ latitude: number; longitude: number; at: number } | null>(null)
  const lastRouteOriginRef = useRef<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const refreshPlanAndMembers = () => {
      void Promise.all([getMyPlanGovernance(planId), getMyPlanMembers(planId)])
        .then(([nextPlan, nextMembers]) => {
          if (cancelled) return
          setPlan(nextPlan)
          setMembers(nextMembers)
          setError(null)
        })
        .catch((loadError) => {
          if (!cancelled) setError(toUserFacingError(loadError, 'Unable to refresh meetup details right now.'))
        })
    }

    void Promise.all([getMyPlanGovernance(planId), getMyPlanMembers(planId), getMyPlanAttendanceStatus(planId)])
      .then(([nextPlan, nextMembers, nextAttendance]) => {
        if (cancelled) return
        setPlan(nextPlan)
        setMembers(nextMembers)
        setAttendance(nextAttendance)
        setError(null)
      })
      .catch((loadError) => {
        if (!cancelled) setError(toUserFacingError(loadError, 'Unable to load meetup details right now.'))
      })

    const unsubscribeGovernance = subscribeToPlanGovernance(planId, refreshPlanAndMembers)
    return () => {
      cancelled = true
      unsubscribeGovernance()
    }
  }, [planId])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    const refreshLocations = () => void getMyPlanMemberLocations(planId).then(setLiveLocations).catch(() => undefined)
    refreshLocations()
    const refreshId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshLocations()
    }, 15_000)
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const latitude = position.coords.latitude
        const longitude = position.coords.longitude
        setUserPosition({ latitude, longitude })

        const previous = lastLocationPublishRef.current
        const now = Date.now()
        const movedEnough = !previous || Math.abs(latitude - previous.latitude) >= 0.0001 || Math.abs(longitude - previous.longitude) >= 0.0001
        const staleEnough = !previous || now - previous.at >= 15_000
        if (!movedEnough && !staleEnough) return

        lastLocationPublishRef.current = { latitude, longitude, at: now }
        void setMyPlanLocation(planId, position).then(refreshLocations).catch(() => undefined)
      },
      () => setUserPosition(null),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
    )
    return () => { navigator.geolocation.clearWatch(watchId); window.clearInterval(refreshId) }
  }, [planId])

  useEffect(() => {
    if (!attendance?.windowOpensAt || !attendance.windowClosesAt || attendance.checkedIn) return
    const timer = window.setInterval(() => { void getMyPlanAttendanceStatus(planId).then(setAttendance).catch(() => undefined) }, 10_000)
    return () => window.clearInterval(timer)
  }, [attendance?.checkedIn, attendance?.windowClosesAt, attendance?.windowOpensAt, planId])

  const checkIn = async () => {
    if (attendanceBusy || !attendance?.canCheckIn) return
    setAttendanceBusy(true); setError(null)
    try { const next = await checkInToMyPlan(planId); setAttendance(next); if (next.checkedIn) onCheckedIn(planId) }
    catch (e) { setError(toUserFacingError(e, 'Unable to check you in right now. Please try again.')) }
    finally { setAttendanceBusy(false) }
  }

  const destination = useMemo(() => {
    if (!plan || plan.currentVenueLatitude == null || plan.currentVenueLongitude == null) return null
    const latitude = Number(plan.currentVenueLatitude), longitude = Number(plan.currentVenueLongitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null
  }, [plan])

  const showDirections = async () => {
    if (route) {
      setRoute(null)
      setRouteError(null)
      return
    }
    if (!userPosition || routeLoading) return
    setRouteLoading(true)
    setRouteError(null)
    try {
      setRoute(await getSignalRoute(planId, userPosition.latitude, userPosition.longitude))
      lastRouteOriginRef.current = userPosition
    }
    catch { setRouteError('Unable to load live directions right now.') }
    finally { setRouteLoading(false) }
  }

  useEffect(() => {
    if (!route || !userPosition) return
    const previous = lastRouteOriginRef.current
    if (previous) {
      const movedEnough = Math.abs(userPosition.latitude - previous.latitude) >= 0.0005
        || Math.abs(userPosition.longitude - previous.longitude) >= 0.0005
      if (!movedEnough) return
    }

    const refreshId = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      void getSignalRoute(planId, userPosition.latitude, userPosition.longitude)
        .then((nextRoute) => {
          setRoute(nextRoute)
          lastRouteOriginRef.current = userPosition
        })
        .catch(() => undefined)
    }, 1_500)
    return () => window.clearTimeout(refreshId)
  }, [planId, route, userPosition])

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
      <header><span><Radio size={14}/> {route ? 'NAVIGATING' : 'LIVE MAP'}</span><strong>{route ? 'LIVE DIRECTIONS' : userPosition ? 'YOU + DESTINATION' : 'DESTINATION READY'}</strong></header>
      {destination && <div className="signal-details-map-wrap"><SignalLiveMap destination={destination} userPosition={userPosition} people={liveLocations} route={route} /></div>}
      <div className="signal-details-destination-strip"><MapPin size={18}/><span><small>{route ? 'NAVIGATING TO' : 'MEET HERE'}</small><strong>{plan?.currentVenueName ?? 'Meetup venue'}</strong><em>{plan?.currentVenueAddress ?? ''}</em></span><button type="button" onClick={() => void showDirections()} disabled={!userPosition || routeLoading}><Navigation size={15}/>{routeLoading ? ' ROUTING…' : route ? ' HIDE ROUTE' : ' DIRECTIONS'}</button></div>
      {route && <div className="signal-details-route-stats"><em>LIVE TRIP</em><span><small>DISTANCE</small><strong>{route.distanceMeters == null ? '—' : `${(route.distanceMeters / 1609.344).toFixed(route.distanceMeters < 16093 ? 1 : 0)} MI`}</strong></span><span><small>DRIVE</small><strong>{route.durationSeconds == null ? '—' : `${Math.max(1, Math.round(route.durationSeconds / 60))} MIN`}</strong></span><span><small>ETA</small><strong>{route.durationSeconds == null ? '—' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(route.calculatedAt + route.durationSeconds * 1000))}</strong></span></div>}
      {routeError && <div className="signal-details-route-error">{routeError}</div>}
    </section>
    <section className="signal-details-group">
      <header><span><Users size={15}/> YOUR PEOPLE</span><strong>{members.length} LOCKED IN</strong></header>
      <div>{members.map((m) => <span key={m.userId}>{m.avatarUrl ? <img src={m.avatarUrl} alt=""/> : <i>{m.displayName.slice(0,1).toUpperCase()}</i>}<small>{m.isMe ? 'YOU' : m.displayName}</small><em>IN</em></span>)}</div>
    </section>
    <section className="signal-details-arrival">
      {attendance?.checkedIn ? (
        <div className="signal-details-arrival-checked"><MapPin size={17}/><span><small>YOU'RE HERE</small><strong>{attendance.checkedInCount}/{attendance.activeMemberCount} checked in</strong></span></div>
      ) : attendance?.canCheckIn ? (
        <button type="button" disabled={attendanceBusy} onClick={() => { void checkIn() }}><MapPin size={18}/><span><strong>{attendanceBusy ? 'CHECKING YOU IN…' : "I'M HERE"}</strong><small>Check in and enter Live Signal</small></span></button>
      ) : attendance?.windowOpensAt && new Date(attendance.windowOpensAt).getTime() > new Date(attendance.serverNow).getTime() ? (
        <button type="button" className="signal-details-arrival-early" disabled aria-disabled="true"><MapPin size={18}/><span><strong>I'M HERE</strong><small>Check-in opens 30 minutes before meetup</small></span><Clock3 size={16}/></button>
      ) : (
        <button type="button" className="signal-details-arrival-unavailable" disabled aria-disabled="true"><MapPin size={18}/><span><strong>I'M HERE</strong><small>Check-in isn't available right now</small></span></button>
      )}
    </section>
    <div className={`signal-details-controls ${planOptionsOpen ? 'options-open' : ''}`} aria-hidden={!planOptionsOpen}>
      {planOptionsMounted ? <PlanGovernancePanel planId={planId} onCheckedIn={onCheckedIn} onLeftPlan={() => onPlanEnded()} /> : null}
    </div>
    <button type="button" className={`signal-details-options-toggle ${planOptionsOpen ? 'open' : ''}`} aria-expanded={planOptionsOpen} onClick={() => { setPlanOptionsMounted(true); setPlanOptionsOpen((open) => !open) }}><span>PLAN OPTIONS</span><ChevronDown size={16}/></button>
  </section>
}
