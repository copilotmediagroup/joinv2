import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type RequestBody = { signalGroupId: string; limit?: number; allowCityFallback?: boolean }
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
function fairTravelScore(averageMiles: number, maxMiles: number) {
  const averageScore = distanceScore(averageMiles)
  const farthestPenalty = maxMiles > 15 ? 24 : maxMiles > 12 ? 18 : maxMiles > 10 ? 12 : maxMiles > 8 ? 7 : maxMiles > 6 ? 3 : 0
  return averageScore - farthestPenalty
}
const MIN_USABLE_OPEN_MINUTES = 150
const WEEK_MINUTES = 7 * 24 * 60

function venueWeekMinute(epochMs: number, offsetMinutes: number): number {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  return local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes()
}

function minutesUntilCurrentClose(place: { currentOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number } | null; close?: { day?: number; hour?: number; minute?: number } | null }> } | null; utcOffsetMinutes?: number | null }): number | null {
  const offset = typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null
  const periods = place.currentOpeningHours?.periods
  if (offset === null || !Array.isArray(periods) || periods.length === 0) return null
  const nowMinute = venueWeekMinute(Date.now(), offset)
  for (const period of periods) {
    if (!period.open) continue
    const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
    let close = period.close
      ? (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
      : open + WEEK_MINUTES
    if (close <= open) close += WEEK_MINUTES
    const candidates = [nowMinute, nowMinute + WEEK_MINUTES]
    for (const candidate of candidates) {
      if (candidate >= open && candidate < close) return close - candidate
    }
  }
  return null
}function cityLocalHour(timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
  return Number(hour)
}

type VenueTimeBand = 'morning' | 'daytime' | 'evening' | 'late_night'

function timeBandFor(localHour: number): VenueTimeBand {
  if (localHour >= 6 && localHour < 10) return 'morning'
  if (localHour >= 10 && localHour < 17) return 'daytime'
  if (localHour >= 17 && localHour < 22) return 'evening'
  return 'late_night'
}

function searchIntentFor(slug: string, activityName: string, localHour: number): string {
  const band = timeBandFor(localHour)
  if (slug === 'chill') {
    if (band === 'morning') return 'Starbucks coffee shops cafes breakfast cafes relaxed morning hangout spots'
    if (band === 'daytime') return 'coffee shops cafes dessert shops casual social hangout spots parks'
    if (band === 'evening') return 'lounges rooftop lounges cafes dessert shops casual social restaurants'
    return 'late night lounges hotel bars cocktail lounges bars pubs late night restaurants'
  }
  if (slug === 'sports' && band === 'late_night') return '24 hour gyms indoor sports centers late night recreation centers'
  if (slug === 'outdoors' && band === 'late_night') return 'well lit public outdoor recreation open late'
  if (slug === 'creative' && band === 'late_night') return 'late night creative studios paint and sip art experiences'
  return SEARCH_QUERIES[slug] ?? `${activityName} venues and activities`
}

function facilityFit(slug: string, name: string, category: string, localHour: number) {
  const text = `${name} ${category}`.toLowerCase()
  if (slug === 'chill') {
    const band = timeBandFor(localHour)
    const morning = band === 'morning'
    const starbucks = text.includes('starbucks')
    const coffee = ['coffee', 'cafe', 'bakery'].some((term) => text.includes(term))
    const lateNightSocial = ['bar', 'lounge', 'cocktail', 'hotel', 'pub', 'brewery', 'nightclub']

    if (morning) {
      if (starbucks) return 40
      if (coffee) return 18
      if (lateNightSocial.some((term) => text.includes(term))) return -12
      return 0
    }

    if (band === 'late_night' && lateNightSocial.some((term) => text.includes(term))) return 22
    if (band === 'evening' && lateNightSocial.some((term) => text.includes(term))) return 14
    if (band === 'daytime' && coffee) return 12
    if (band === 'late_night' && coffee) return -4
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

    const { signalGroupId, limit = 3, allowCityFallback = false } = await request.json() as RequestBody
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
      domain.from('cities').select('name,slug,latitude,longitude,timezone_name,is_active').eq('id', group.city_id).single(),
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

    const cityLatitude = Number(city.latitude)
    const cityLongitude = Number(city.longitude)
    if (!Number.isFinite(cityLatitude) || !Number.isFinite(cityLongitude)) {
      throw new Error('Signal city coordinates are unavailable')
    }

    const { data: activeMembers, error: activeMembersError } = await domain
      .from('signal_group_memberships')
      .select('user_id')
      .eq('signal_group_id', signalGroupId)
      .eq('state', 'confirmed')
      .eq('is_active_core', true)
    if (activeMembersError) throw activeMembersError

    const activeUserIds = (activeMembers ?? []).map((row) => row.user_id)
    const nowIso = new Date().toISOString()
    const recentCutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    let validMemberLocations: Array<{ latitude: number; longitude: number }> = []
    if (activeUserIds.length > 0) {
      const { data: memberLocations, error: memberLocationsError } = await domain
        .from('signal_member_locations')
        .select('user_id,latitude,longitude,accuracy_meters,captured_at,expires_at')
        .eq('signal_group_id', signalGroupId)
        .in('user_id', activeUserIds)
        .gt('expires_at', nowIso)
        .gte('captured_at', recentCutoffIso)
      if (memberLocationsError) throw memberLocationsError

      validMemberLocations = (memberLocations ?? [])
        .map((row) => ({
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          accuracy: row.accuracy_meters === null ? null : Number(row.accuracy_meters),
        }))
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .filter((point) => point.accuracy === null || point.accuracy <= 5000)
        .filter((point) => milesBetween(cityLatitude, cityLongitude, point.latitude, point.longitude) <= 40)
        .map(({ latitude, longitude }) => ({ latitude, longitude }))
    }

    const requiredLocationCount = activeUserIds.length <= 1
      ? activeUserIds.length
      : Math.max(2, Math.ceil(activeUserIds.length / 2))
    const hasGroupMeetingPoint = requiredLocationCount > 0 && validMemberLocations.length >= requiredLocationCount
    if (!hasGroupMeetingPoint && !allowCityFallback) {
      return json({ error: 'group_location_pending' }, 409)
    }

    const searchLatitude = hasGroupMeetingPoint
      ? validMemberLocations.reduce((sum, point) => sum + point.latitude, 0) / validMemberLocations.length
      : cityLatitude
    const searchLongitude = hasGroupMeetingPoint
      ? validMemberLocations.reduce((sum, point) => sum + point.longitude, 0) / validMemberLocations.length
      : cityLongitude
    const travelLocations = hasGroupMeetingPoint ? validMemberLocations : []

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not configured')

    if (typeof city.timezone_name !== 'string' || !city.timezone_name.trim()) {
      throw new Error('Signal city timezone is unavailable')
    }
    const localHour = cityLocalHour(city.timezone_name)
    if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
      throw new Error('Signal city local time is unavailable')
    }
    const searchIntent = searchIntentFor(activity.slug, activity.name, localHour)
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
        locationBias: { circle: { center: { latitude: searchLatitude, longitude: searchLongitude }, radius: 16093.4 } },
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
      const centerMiles = Number(milesBetween(searchLatitude, searchLongitude, lat, lng).toFixed(2))
      const memberDistances = travelLocations.map((point) => milesBetween(point.latitude, point.longitude, lat, lng))
      const groupTravelAverageMiles = memberDistances.length > 0
        ? Number((memberDistances.reduce((sum, value) => sum + value, 0) / memberDistances.length).toFixed(2))
        : null
      const groupTravelMaxMiles = memberDistances.length > 0
        ? Number(Math.max(...memberDistances).toFixed(2))
        : null
      const miles = groupTravelAverageMiles ?? centerMiles
      const rating = typeof place.rating === 'number' ? place.rating : null
      const ratingCount = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0
      const openNow = typeof place.currentOpeningHours?.openNow === 'boolean'
        ? place.currentOpeningHours.openNow : null
      const openMinutesRemaining = openNow === true ? minutesUntilCurrentClose(place) : null
      const supportsSignalWindow = openNow !== true || openMinutesRemaining === null || openMinutesRemaining >= MIN_USABLE_OPEN_MINUTES
      const category = place.primaryType ?? activity.slug
      const photo = place.photos?.[0] ?? null
      const photoName = typeof photo?.name === 'string' ? photo.name : null
      const relevance = rawPlaces.length <= 1 ? 10 : Number((10 * (1 - index / (rawPlaces.length - 1))).toFixed(2))
      const fit = facilityFit(activity.slug, place.displayName?.text ?? '', category, localHour)
      const travelScore = groupTravelAverageMiles !== null && groupTravelMaxMiles !== null
        ? fairTravelScore(groupTravelAverageMiles, groupTravelMaxMiles)
        : distanceScore(centerMiles)
      const score = travelScore + ratingScore(rating) + confidenceScore(ratingCount) +
        (openNow === true ? 10 : openNow === null ? 5 : 0) + relevance + fit

      return {
        placeId: place.id ?? '',
        name: place.displayName?.text ?? 'Unknown place',
        address: place.formattedAddress ?? '', lat, lng, distanceMiles: miles,
        groupTravelAverageMiles: groupTravelAverageMiles ?? undefined,
        groupTravelMaxMiles: groupTravelMaxMiles ?? undefined,
        rating, ratingCount, category, openNow, openMinutesRemaining, supportsSignalWindow,
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
          distance: travelScore, rating: ratingScore(rating),
          confidence: confidenceScore(ratingCount),
          availability: openNow === true ? 10 : openNow === null ? 5 : 0,
          relevance, facilityFit: fit, localHour,
        },
      }
    }))

    const confirmedOpenPlaces = places.filter((place) => place.placeId.length > 0 && place.openNow === true && place.supportsSignalWindow)
    const unknownHoursPlaces = places.filter((place) => place.placeId.length > 0 && place.openNow === null)
    const eligiblePlaces = confirmedOpenPlaces.length >= 2
      ? confirmedOpenPlaces
      : [...confirmedOpenPlaces, ...unknownHoursPlaces]

    const ranked = eligiblePlaces
      .sort((a, b) =>
        b.signalScore - a.signalScore || b.ratingCount - a.ratingCount || a.distanceMiles - b.distanceMiles,
      )
      .slice(0, Math.min(Math.max(limit, 2), 3))
      .map((place, index) => ({ ...place, signalRank: index + 1 }))

    if (ranked.length < 2) {
      return json({ error: 'Not enough open venues fit this Signal right now' }, 409)
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
