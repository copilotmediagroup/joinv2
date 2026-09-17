import { supabase } from '../../lib/supabaseClient'

export type SignalRoute = {
  points: Array<[number, number]>
  distanceMeters: number | null
  durationSeconds: number | null
}

function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

export async function getSignalRoute(planId: string, latitude: number, longitude: number): Promise<SignalRoute> {
  const { data, error } = await supabase.functions.invoke('signal-route', {
    body: { planId, origin: { latitude, longitude } },
  })
  if (error) throw error
  if (!data?.encodedPolyline) throw new Error('Route unavailable')
  const duration = typeof data.duration === 'string' ? Number(data.duration.replace(/s$/, '')) : null
  return {
    points: decodePolyline(data.encodedPolyline),
    distanceMeters: Number.isFinite(Number(data.distanceMeters)) ? Number(data.distanceMeters) : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  }
}
