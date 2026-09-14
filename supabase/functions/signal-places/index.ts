import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type RequestBody = { signalGroupId: string; limit?: number }
type DomainClient = ReturnType<typeof createClient>
type Json = Record<string, unknown>

const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
const SEARCH_QUERIES: Record<string, string> = {
  sports: 'sports complexes recreation centers gyms and athletic centers',
  creative: 'art studios creative workshops and paint and sip studios',
  nightlife: 'nightlife bars lounges and rooftop venues',
  music: 'live music venues',
  outdoors: 'parks outdoor recreation and activity venues',
  explore: 'local attractions experiences and things to do',
  chill: 'late night lounges bars hotel bars cocktail lounges coffee shops and relaxed social hangout spots',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function hostedKey(name: string): string | null {
  const raw = Deno.env.get(name)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.default === 'string' ? parsed.default : null
  } catch {
    return null
  }
}

function radians(value: number) { return (value * Math.PI) / 180 }
function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = radians(lat2 - lat1)
  const dLng = radians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function distanceScore(miles: number) {
  if (miles <= 1) return 35
  if (miles <= 2) return 31
  if (miles <= 3) return 27
  if (miles <= 5) return 21
  if (miles <= 7) return 14
  if (miles <= 10) return 7
  return 0
}
function ratingScore(rating: number | null) {
  if (rating === null) return 8
  if (rating >= 4.8) return 25
  if (rating >= 4.6) return 22
  if (rating >= 4.4) return 19
  if (rating >= 4.2) return 16
  if (rating >= 4.0) return 13
  if (rating >= 3.5) return 8
  return 3
}
function confidenceScore(count: number) {
  if (count >= 1000) return 20
  if (count >= 500) return 18
  if (count >= 250) return 16
  if (count >= 100) return 13
  if (count >= 50) return 10
  if (count >= 20) return 7
  if (count >= 5) return 4
  return 1
}
function facilityFit(slug: string, name: string, category: string) {
  const text = `${name} ${category}`.toLowerCase()
  if (slug === 'chill') {
    const lateNightSocial = ['bar', 'lounge', 'cocktail', 'hotel', 'pub', 'brewery', 'nightclub']
    const daytimeLeaning = ['coffee', 'cafe', 'bakery']
    if (lateNightSocial.some((term) => text.includes(term))) return 16
    if (daytimeLeaning.some((term) => text.includes(term))) return -4
    return 0
  }
  if (slug !== 'sports') return 0
  const indoor = ['basketball', 'recreation center', 'community center', 'sports complex', 'sports center', 'athletic center', 'gym', 'fitness', 'ymca']
  const outdoor = ['park', 'playground', 'trail', 'nature', 'outdoor']
  const inside = indoor.some((term) => text.includes(term))
  const outside = outdoor.some((term) => text.includes(term))
  if (inside && !outside) return 25
  if (inside && outside) return 8
  if (outside) return -30
  return 0
}

async function loadRound(client: DomainClient, groupId: string, userId: string) {
  const { data: round, error: roundError } = await client
    .from('signal_venue_rounds')
    .select('id,round_number,round_kind,state,opens_at,closes_at,winner_option_id,eligible_voter_count,majority_required')
    .eq('signal_group_id', groupId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (roundError) throw roundError
  if (!round) return null

  const [optionsResult, votesResult] = await Promise.all([
    client.from('signal_venue_options')
      .select('id,source_rank,payload')
      .eq('round_id', round.id)
      .order('source_rank', { ascending: true }),
    client.from('signal_venue_votes')
      .select('user_id,option_id')
      .eq('round_id', round.id),
  ])
  if (optionsResult.error) throw optionsResult.error
  if (votesResult.error) throw votesResult.error

  const voteCounts: Record<string, number> = {}
  let currentUserOptionId: string | null = null
  for (const vote of votesResult.data ?? []) {
    voteCounts[vote.option_id] = (voteCounts[vote.option_id] ?? 0) + 1
    if (vote.user_id === userId) currentUserOptionId = vote.option_id
  }

  return {
    round: {
      id: round.id,
      roundNumber: round.round_number,
      roundKind: round.round_kind,
      state: round.state,
      opensAt: round.opens_at,
      closesAt: round.closes_at,
      winnerOptionId: round.winner_option_id,
      eligibleVoterCount: round.eligible_voter_count,
      majorityRequired: round.majority_required,
      currentUserOptionId,
      voteCounts,
    },
    places: (optionsResult.data ?? []).map((option) => ({
      ...(option.payload as Json),
      optionId: option.id,
    })),
  }
}

async function placePhotoUrl(apiKey: string, photoName: string | null) {
  if (!photoName) return null
  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1200&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`,
    )
    if (!response.ok) return null
    const data = await response.json()
    return typeof data.photoUri === 'string' ? data.photoUri : null
  } catch {
    return null
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = hostedKey('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY')
    const serverKey = hostedKey('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publishableKey || !serverKey) {
      throw new Error('Signal Places server configuration is incomplete')
    }

    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid or expired authentication' }, 401)

    const { signalGroupId, limit = 3 } = await request.json() as RequestBody
    if (!isUuid(signalGroupId)) return json({ error: 'signalGroupId must be a UUID' }, 400)

    const domain = createClient(supabaseUrl, serverKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { data: membership, error: membershipError } = await domain
      .from('signal_group_memberships')
      .select('id')
      .eq('signal_group_id', signalGroupId)
      .eq('user_id', user.id)
      .in('state', ['matched', 'confirmed'])
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return json({ error: 'Signal membership required' }, 403)

    const { data: group, error: groupError } = await domain
      .from('signal_groups')
      .select('city_id,activity_id,state')
      .eq('id', signalGroupId)
      .single()
    if (groupError || !group) throw groupError ?? new Error('Signal group not found')
    if (!['locked', 'coordinating'].includes(group.state)) {
      return json({ error: 'Signal is not ready for venue selection' }, 409)
    }

    const [{ data: city, error: cityError }, { data: activity, error: activityError }] = await Promise.all([
      domain.from('cities').select('name,slug,latitude,longitude,is_active').eq('id', group.city_id).single(),
      domain.from('activities').select('name,slug,is_active').eq('id', group.activity_id).single(),
    ])
    if (cityError || !city?.is_active) throw cityError ?? new Error('Signal city is unavailable')
    if (activityError || !activity?.is_active) throw activityError ?? new Error('Signal activity is unavailable')

    const existing = await loadRound(domain, signalGroupId, user.id)
    if (existing) {
      return json({
        version: 'signal-venue-vote-v1', source: 'database', query: null,
        activitySlug: activity.slug, citySlug: city.slug, ...existing,
      })
    }

    const { data: exclusionRows, error: exclusionError } = await domain
      .from('signal_venue_exclusions')
      .select('place_id')
      .eq('signal_group_id', signalGroupId)
    if (exclusionError) throw exclusionError
    const excludedPlaceIds = new Set(
      (exclusionRows ?? []).map((row) => row.place_id),
    )

    const latitude = Number(city.latitude)
    const longitude = Number(city.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Signal city coordinates are unavailable')
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not configured')

    const searchIntent = SEARCH_QUERIES[activity.slug] ?? `${activity.name} venues and activities`
    const query = `${searchIntent} in ${city.name}`
    const googleResponse = await fetch(GOOGLE_PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id','places.displayName','places.formattedAddress','places.location',
          'places.rating','places.userRatingCount','places.primaryType',
          'places.currentOpeningHours.openNow','places.currentOpeningHours.periods',
          'places.currentOpeningHours.weekdayDescriptions','places.utcOffsetMinutes',
          'places.photos','places.googleMapsUri','places.reviews',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 15,
        locationBias: { circle: { center: { latitude, longitude }, radius: 16093.4 } },
      }),
    })
    if (!googleResponse.ok) {
      throw new Error(`Google Places failed (${googleResponse.status}): ${await googleResponse.text()}`)
    }

    const googleData = await googleResponse.json()
    const rawPlaces = (Array.isArray(googleData.places) ? googleData.places : [])
      .filter((place: { id?: unknown }) =>
        typeof place.id !== 'string' || !excludedPlaceIds.has(place.id),
      )
    // Google Places response is runtime-validated field-by-field below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places = await Promise.all(rawPlaces.map(async (place: any, index: number) => {
      const lat = Number(place.location?.latitude ?? 0)
      const lng = Number(place.location?.longitude ?? 0)
      const miles = Number(milesBetween(latitude, longitude, lat, lng).toFixed(2))
      const rating = typeof place.rating === 'number' ? place.rating : null
      const ratingCount = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0
      const openNow = typeof place.currentOpeningHours?.openNow === 'boolean'
        ? place.currentOpeningHours.openNow : null
      const category = place.primaryType ?? activity.slug
      const photo = place.photos?.[0] ?? null
      const photoName = typeof photo?.name === 'string' ? photo.name : null
      const relevance = rawPlaces.length <= 1 ? 10 : Number((10 * (1 - index / (rawPlaces.length - 1))).toFixed(2))
      const fit = facilityFit(activity.slug, place.displayName?.text ?? '', category)
      const score = distanceScore(miles) + ratingScore(rating) + confidenceScore(ratingCount) +
        (openNow === true ? 10 : openNow === null ? 5 : 0) + relevance + fit

      return {
        placeId: place.id ?? '',
        name: place.displayName?.text ?? 'Unknown place',
        address: place.formattedAddress ?? '', lat, lng, distanceMiles: miles,
        rating, ratingCount, category, openNow,
        utcOffsetMinutes: typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null,
        openingHours: place.currentOpeningHours ? {
          periods: Array.isArray(place.currentOpeningHours.periods) ? place.currentOpeningHours.periods : [],
          weekdayDescriptions: Array.isArray(place.currentOpeningHours.weekdayDescriptions)
            ? place.currentOpeningHours.weekdayDescriptions.filter((x: unknown) => typeof x === 'string') : [],
        } : null,
        photoName,
        photoUrl: await placePhotoUrl(apiKey, photoName),
        photoAttributions: Array.isArray(photo?.authorAttributions) ? photo.authorAttributions.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => ({
          displayName: typeof a.displayName === 'string' ? a.displayName : 'Google Maps contributor',
          uri: typeof a.uri === 'string' ? a.uri : null,
          photoUri: typeof a.photoUri === 'string' ? a.photoUri : null,
          }),
        ) : [],
        googleMapsUri: typeof place.googleMapsUri === 'string' ? place.googleMapsUri : null,
        reviews: Array.isArray(place.reviews) ? place.reviews.slice(0, 3).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (review: any) => ({
          rating: typeof review.rating === 'number' ? review.rating : 0,
          text: typeof review.text?.text === 'string' ? review.text.text : '',
          relativeTime: typeof review.relativePublishTimeDescription === 'string' ? review.relativePublishTimeDescription : null,
          authorName: typeof review.authorAttribution?.displayName === 'string' ? review.authorAttribution.displayName : 'Google Maps user',
          authorPhotoUrl: typeof review.authorAttribution?.photoUri === 'string' ? review.authorAttribution.photoUri : null,
          authorUri: typeof review.authorAttribution?.uri === 'string' ? review.authorAttribution.uri : null,
          googleMapsUri: typeof review.googleMapsUri === 'string' ? review.googleMapsUri : null,
          }),
        ).filter((review: { text: string }) => review.text.length > 0) : [],
        signalRank: 0,
        signalScore: Number(score.toFixed(2)),
        scoreBreakdown: {
          distance: distanceScore(miles), rating: ratingScore(rating),
          confidence: confidenceScore(ratingCount),
          availability: openNow === true ? 10 : openNow === null ? 5 : 0,
          relevance, facilityFit: fit,
        },
      }
    }))

    const ranked = places
      .filter((place) => place.placeId.length > 0)
      .sort((a, b) => {
        const availabilityOrder = (value: boolean | null) => value === true ? 0 : value === null ? 1 : 2
        return availabilityOrder(a.openNow) - availabilityOrder(b.openNow) ||
          b.signalScore - a.signalScore || b.ratingCount - a.ratingCount || a.distanceMiles - b.distanceMiles
      })
      .slice(0, Math.min(Math.max(limit, 2), 3))
      .map((place, index) => ({ ...place, signalRank: index + 1 }))

    if (ranked.length < 2) {
      return json({ error: 'Not enough eligible venues remain for this Signal' }, 409)
    }

    const { error: ensureError } = await domain.rpc('ensure_signal_venue_round', {
      p_signal_group_id: signalGroupId,
      p_options: ranked,
    })
    if (ensureError) throw ensureError

    const persisted = await loadRound(domain, signalGroupId, user.id)
    if (!persisted) throw new Error('Signal venue round could not be initialized')

    return json({
      version: 'signal-venue-vote-v1', source: 'google', query,
      activitySlug: activity.slug, citySlug: city.slug, ...persisted,
    })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Unknown server error' }, 500)
  }
})
