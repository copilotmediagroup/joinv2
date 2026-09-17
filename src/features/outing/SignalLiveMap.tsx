import { useEffect, useMemo } from 'react'
import { divIcon, latLngBounds } from 'leaflet'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { PlanLiveLocation } from './planLiveLocationClient'
import type { SignalRoute } from './signalRouteClient'

type Point = { latitude: number; longitude: number }
type Props = {
  destination: Point
  userPosition: Point | null
  people: PlanLiveLocation[]
  route: SignalRoute | null
}

const blueIcon = divIcon({ className: 'signal-live-map-icon', html: '<span class="signal-live-dot user"><i></i><b>YOU</b></span>', iconSize: [52, 52], iconAnchor: [26, 26] })
const redIcon = divIcon({ className: 'signal-live-map-icon', html: '<span class="signal-live-dot destination"><i></i><b>DESTINATION</b></span>', iconSize: [80, 52], iconAnchor: [40, 26] })

function Camera({ destination, userPosition, route }: { destination: Point; userPosition: Point | null; route: SignalRoute | null }) {
  const map = useMap()
  useEffect(() => {
    const routePoints = route?.points ?? []
    if (routePoints.length > 1) {
      map.fitBounds(latLngBounds(routePoints), { padding: [42, 42], maxZoom: 17, animate: true })
      return
    }
    if (userPosition) {
      map.fitBounds(latLngBounds([[userPosition.latitude, userPosition.longitude], [destination.latitude, destination.longitude]]), { padding: [55, 55], maxZoom: 17, animate: true })
      return
    }
    map.setView([destination.latitude, destination.longitude], 15, { animate: true })
  }, [destination.latitude, destination.longitude, map, route, userPosition])
  return null
}

export default function SignalLiveMap({ destination, userPosition, people, route }: Props) {
  const otherPeople = useMemo(() => people.filter((person) => !person.isMe), [people])
  return <MapContainer className="signal-live-map" center={[destination.latitude, destination.longitude]} zoom={14} zoomControl>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Camera destination={destination} userPosition={userPosition} route={route} />
    <Marker position={[destination.latitude, destination.longitude]} icon={redIcon} />
    {userPosition && <Marker position={[userPosition.latitude, userPosition.longitude]} icon={blueIcon} />}
    {otherPeople.map((person) => <Marker key={person.userId} position={[person.latitude, person.longitude]} icon={divIcon({ className: 'signal-live-map-icon', html: '<span class="signal-live-member-dot"></span>', iconSize: [16,16], iconAnchor: [8,8] })} />)}
    {route && <Polyline positions={route.points} pathOptions={{ color: '#56cfff', weight: 6, opacity: .9 }} />}
  </MapContainer>
}
