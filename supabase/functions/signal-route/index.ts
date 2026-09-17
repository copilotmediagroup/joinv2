import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function hostedKey(name: string): string | null {
  const raw = Deno.env.get(name)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.default === 'string' ? parsed.default : raw
  } catch { return raw }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) return json({ error: 'authentication_required' }, 401)
    const body = await req.json()
    const planId = typeof body?.planId === 'string' ? body.planId : ''
    const latitude = Number(body?.origin?.latitude), longitude = Number(body?.origin?.longitude)
    if (!planId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return json({ error: 'invalid_route_request' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: plan, error: planError } = await client.rpc('get_my_plan_governance', { p_plan_id: planId })
    if (planError || !plan) return json({ error: 'plan_access_required' }, 403)
    const destLat = Number(plan.currentVenueLatitude), destLng = Number(plan.currentVenueLongitude)
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return json({ error: 'destination_unavailable' }, 409)

    const apiKey = hostedKey('GOOGLE_MAPS_API_KEY')
    if (!apiKey) return json({ error: 'routing_not_configured' }, 503)
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude, longitude } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
      }),
    })
    if (!response.ok) return json({ error: 'route_provider_failed', status: response.status }, 502)
    const payload = await response.json()
    const route = payload?.routes?.[0]
    if (!route?.polyline?.encodedPolyline) return json({ error: 'route_unavailable' }, 404)
    return json({ encodedPolyline: route.polyline.encodedPolyline, distanceMeters: route.distanceMeters ?? null, duration: route.duration ?? null })
  } catch {
    return json({ error: 'route_request_failed' }, 500)
  }
})
