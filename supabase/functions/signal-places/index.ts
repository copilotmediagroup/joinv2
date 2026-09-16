import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type RequestBody = { signalGroupId: string; limit?: number; allowCityFallback?: boolean }
type DomainClient = ReturnType<typeof createClient>
type Json = Record<string, unknown>

const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
const SEARCH_QUERIES: Record<string, string> = {
  drinks: 'bars lounges breweries wine bars and social drink spots',
  sports: 'sports complexes recreation centers gyms and athletic centers',
  creative: 'art studios creative workshops pottery and paint and sip studios',
  food: 'restaurants food halls diners and social dining',
  nightlife: 'nightlife bars lounges dance clubs and rooftop venues',
  music: 'live music venues jazz clubs and music bars',
  outdoors: 'parks waterfronts trails and outdoor recreation',
  explore: 'local attractions experiences museums arcades and things to do',
  chill: 'coffee shops cafes lounges and relaxed social hangout spots',
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
const WEEK_MINUTES = 7 * 24 * 60

function venueWeekMinute(epochMs: number, offsetMinutes: number): number {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  return local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes()
}

function periodContainsWindow(
  pointWeekMinute: number,
  durationMinutes: number,
  openWeekMinute: number,
  closeWeekMinute: number,
): boolean {
  let close = closeWeekMinute
  if (close <= openWeekMinute) close += WEEK_MINUTES
  for (const point of [pointWeekMinute, pointWeekMinute + WEEK_MINUTES]) {
    for (const open of [openWeekMinute, openWeekMinute + WEEK_MINUTES]) {
      const normalizedClose = close + (open - openWeekMinute)
      if (point >= open && point + durationMinutes <= normalizedClose) return true
    }
  }
  return false
}

// Guard the subtle midnight/week-boundary behavior that previously rejected
// valid late-night venues after midnight.
if (!periodContainsWindow(1500, 35, 1200, 1560) ||
    !periodContainsWindow(60, 35, 6 * 1440 + 1200, 120) ||
    periodContainsWindow(130, 35, 6 * 1440 + 1200, 120)) {
  throw new Error('signal-places opening-hours invariant failed')
}

function minutesUntilCurrentClose(place: { currentOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number } | null; close?: { day?: number; hour?: number; minute?: number } | null }> } | null; utcOffsetMinutes?: number | null }, epochMs = Date.now()): number | null {
  const offset = typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null
  const periods = place.currentOpeningHours?.periods
  if (offset === null || !Array.isArray(periods) || periods.length === 0) return null
  const nowMinute = venueWeekMinute(epochMs, offset)
  for (const period of periods) {
    if (!period.open) continue
    const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
    let close = period.close
      ? (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
      : open + WEEK_MINUTES
    if (close <= open) close += WEEK_MINUTES
    for (const point of [nowMinute, nowMinute + WEEK_MINUTES]) {
      for (const normalizedOpen of [open, open + WEEK_MINUTES]) {
        const normalizedClose = close + (normalizedOpen - open)
        if (point >= normalizedOpen && point < normalizedClose) {
          return normalizedClose - point
        }
      }
    }
  }
  return null
}function cityLocalHour(timeZone: string, epochMs = Date.now()): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epochMs))
  return Number(hour)
}

type VenueTimeBand = 'morning' | 'daytime' | 'evening' | 'late_night'

const LATE_NIGHT_MINIMUM_OPEN_MINUTES = 45
const LATE_NIGHT_WINDOW_FLOOR_MINUTES = 90

function timeBandFor(localHour: number): VenueTimeBand {
  if (localHour >= 6 && localHour < 10) return 'morning'
  if (localHour >= 10 && localHour < 17) return 'daytime'
  if (localHour >= 17 && localHour < 22) return 'evening'
  return 'late_night'
}

function searchIntentFor(slug: string, activityName: string, localHour: number): string {
  const band = timeBandFor(localHour)
  const profiles: Record<string, Record<VenueTimeBand, string>> = {
    drinks: {
      morning: 'brunch restaurants mimosas coffee cocktails and relaxed drink spots',
      daytime: 'breweries wine bars rooftop bars social bars and restaurants with drinks',
      evening: 'cocktail bars breweries wine bars rooftop bars and social bars',
      late_night: 'late night bars lounges pubs hotel bars and cocktail lounges',
    },
    sports: {
      morning: 'gyms indoor basketball courts recreation centers and sports complexes',
      daytime: 'sports complexes recreation centers basketball courts gyms and athletic centers',
      evening: 'indoor sports centers basketball courts gyms and recreation centers open late',
      late_night: '24 hour gyms indoor sports centers and late night recreation centers',
    },
    creative: {
      morning: 'art studios pottery painting studios creative workshops and museums',
      daytime: 'art studios creative workshops pottery painting museums and maker spaces',
      evening: 'paint and sip art studios pottery classes and creative workshops',
      late_night: 'late night paint and sip art experiences and creative studios',
    },
    food: {
      morning: 'breakfast brunch restaurants diners coffee shops and cafes',
      daytime: 'lunch restaurants casual restaurants food halls and local restaurants',
      evening: 'dinner restaurants social restaurants food halls and local dining',
      late_night: 'late night restaurants diners 24 hour restaurants and food open late',
    },
    music: {
      morning: 'live music brunch cafes restaurants and music venues',
      daytime: 'live music cafes breweries and music venues',
      evening: 'live music venues jazz clubs concert venues and music bars',
      late_night: 'live music bars jazz clubs music lounges and venues open late',
    },
    outdoors: {
      morning: 'parks trails waterfronts beaches and outdoor recreation',
      daytime: 'parks trails waterfronts and outdoor recreation activity venues',
      evening: 'waterfront parks boardwalks and outdoor recreation open in the evening',
      late_night: 'well lit waterfront boardwalks and public outdoor recreation open late',
    },
    chill: {
      morning: 'bowling alleys coffee shops cafes movie theaters parks waterfronts arcades and relaxed hangout spots',
      daytime: 'bowling alleys movie theaters cafes dessert shops parks waterfronts arcades and relaxed social activities',
      evening: 'bowling alleys movie theaters arcades cafes dessert shops waterfronts social lounges and relaxed activities',
      late_night: 'bowling alleys arcades movie theaters open late lounges hotel bars cocktail lounges bars pubs and late night hangouts',
    },
    explore: {
      morning: 'markets waterfront attractions museums cafes and sightseeing',
      daytime: 'local attractions museums experiences markets sightseeing and things to do',
      evening: 'local attractions arcades waterfront experiences bowling and things to do',
      late_night: 'late night attractions arcades bowling entertainment and experiences open late',
    },
    nightlife: {
      morning: 'brunch bars rooftop brunch lounges and social venues',
      daytime: 'rooftop bars breweries day clubs social bars and lounges',
      evening: 'nightclubs rooftop bars cocktail lounges dance clubs and nightlife',
      late_night: 'nightclubs bars lounges rooftop venues dance clubs and nightlife open late',
    },
  }
  return profiles[slug]?.[band] ?? SEARCH_QUERIES[slug] ?? `${activityName} venues and activities`
}

function supplementalSearchIntents(slug: string, band: VenueTimeBand): string[] {
  const intents: Record<string, string[]> = {
    chill: band === 'late_night'
      ? ['bowling alleys open late', 'arcades and entertainment open late', 'lounges and relaxed social hangouts open late']
      : ['bowling alleys', 'movie theaters and cinemas', 'arcades cafes dessert shops parks and waterfront hangouts'],
    drinks: ['breweries and taprooms', 'wine bars', 'rooftop cocktail bars and lounges'],
    food: ['food halls and markets', 'diners and casual restaurants', 'local restaurants and social dining'],
    nightlife: ['nightclubs and dance clubs', 'rooftop nightlife', 'live music lounges and cocktail bars'],
    sports: ['basketball courts and recreation centers', 'gyms and athletic centers', 'tennis pickleball and sports complexes'],
    creative: ['pottery and ceramic studios', 'paint and art studios', 'creative workshops maker spaces and museums'],
    music: ['jazz clubs', 'live music venues', 'music bars and lounges'],
    outdoors: ['waterfronts boardwalks and beaches', 'parks', 'trails gardens and outdoor recreation'],
    explore: ['museums and galleries', 'markets attractions and sightseeing', 'arcades bowling and local experiences'],
  }
  return intents[slug] ?? []
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

type CoordinationPolicy = {
  leadMinutes: number
  durationMinutes: number
  closingBufferMinutes: number
  alignmentMinutes: number
}

function coordinationPolicy(slug: string, band: VenueTimeBand): CoordinationPolicy {
  if (band === 'late_night') {
    // Late-night Signals are spontaneous. Do not reject a genuinely open venue
    // merely because less than a full hour remains before its posted close.
    return { leadMinutes: 10, durationMinutes: 30, closingBufferMinutes: 5, alignmentMinutes: 15 }
  }
  if (slug === 'sports' || slug === 'creative') {
    return { leadMinutes: 20, durationMinutes: 90, closingBufferMinutes: 15, alignmentMinutes: 30 }
  }
  return { leadMinutes: 20, durationMinutes: 75, closingBufferMinutes: 15, alignmentMinutes: 15 }
}

function alignVenueTime(epochMs: number, offsetMinutes: number, alignmentMinutes: number): number {
  const localMs = epochMs + offsetMinutes * 60_000
  const step = alignmentMinutes * 60_000
  return Math.ceil(localMs / step) * step - offsetMinutes * 60_000
}

function hasUsableSignalSlot(
  signalStartsAt: number,
  signalEndsAt: number,
  place: {
    currentOpeningHours?: { periods?: Array<{ open?: { day?: number; hour?: number; minute?: number } | null; close?: { day?: number; hour?: number; minute?: number } | null }> } | null
    utcOffsetMinutes?: number | null
  },
  policy: CoordinationPolicy,
  nowEpoch = Date.now(),
): boolean {
  const offset = typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null
  const periods = place.currentOpeningHours?.periods
  if (offset === null || !Array.isArray(periods) || periods.length === 0) return false

  const earliest = alignVenueTime(
    Math.max(signalStartsAt, nowEpoch + policy.leadMinutes * 60_000),
    offset,
    policy.alignmentMinutes,
  )
  const latest = signalEndsAt - policy.durationMinutes * 60_000
  if (earliest > latest) return false

  for (let candidate = earliest; candidate <= latest; candidate += policy.alignmentMinutes * 60_000) {
    const candidateWeekMinute = venueWeekMinute(candidate, offset)
    const fits = periods.some((period) => {
      if (!period.open) return false
      const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
      const close = period.close
        ? (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
        : open + WEEK_MINUTES
      return periodContainsWindow(
        candidateWeekMinute,
        policy.durationMinutes + policy.closingBufferMinutes,
        open,
        close,
      )
    })
    if (fits) return true
  }
  return false
}

function minimumUsableOpenMinutes(slug: string, localHour: number) {
  const band = timeBandFor(localHour)
  if (band === 'late_night') return LATE_NIGHT_MINIMUM_OPEN_MINUTES
  if (slug === 'creative' || slug === 'sports') return 150
  return 125
}

type VenueLane = 'primary' | 'secondary' | 'tertiary' | 'social' | 'other'

function venueLane(slug: string, name: string, category: string): VenueLane {
  const text = `${name} ${category}`.toLowerCase()
  const has = (terms: string[]) => includesAny(text, terms)
  if (slug === 'chill') {
    if (has(['bowling'])) return 'primary'
    if (has(['movie','cinema','theater','theatre'])) return 'secondary'
    if (has(['arcade','game center','amusement','park','waterfront','boardwalk','beach','coffee','cafe','bakery','dessert','tea'])) return 'tertiary'
    if (has(['lounge','bar','pub','cocktail','brewery'])) return 'social'
  }
  if (slug === 'drinks') {
    if (has(['brewery','taproom','beer garden'])) return 'primary'
    if (has(['wine bar','winery'])) return 'secondary'
    if (has(['rooftop','hotel bar'])) return 'tertiary'
    if (has(['cocktail','bar','pub','lounge'])) return 'social'
  }
  if (slug === 'food') {
    if (has(['food hall','market'])) return 'primary'
    if (has(['diner','breakfast','brunch','cafe'])) return 'secondary'
    if (has(['restaurant','grill','bistro','kitchen'])) return 'tertiary'
  }
  if (slug === 'nightlife') {
    if (has(['nightclub','dance club','club'])) return 'primary'
    if (has(['rooftop'])) return 'secondary'
    if (has(['live music','jazz','music venue'])) return 'tertiary'
    if (has(['cocktail','lounge','bar'])) return 'social'
  }
  if (slug === 'sports') {
    if (has(['basketball','sports complex','recreation center'])) return 'primary'
    if (has(['gym','fitness','athletic'])) return 'secondary'
    if (has(['tennis','pickleball','soccer','volleyball'])) return 'tertiary'
  }
  if (slug === 'creative') {
    if (has(['pottery','ceramic'])) return 'primary'
    if (has(['paint','art studio'])) return 'secondary'
    if (has(['museum','maker','workshop'])) return 'tertiary'
  }
  if (slug === 'music') {
    if (has(['jazz'])) return 'primary'
    if (has(['concert','music venue','live music'])) return 'secondary'
    if (has(['bar','lounge','brewery'])) return 'social'
  }
  if (slug === 'outdoors') {
    if (has(['waterfront','boardwalk','beach'])) return 'primary'
    if (has(['park'])) return 'secondary'
    if (has(['trail','nature','garden'])) return 'tertiary'
  }
  if (slug === 'explore') {
    if (has(['museum','gallery'])) return 'primary'
    if (has(['market','attraction','sightseeing'])) return 'secondary'
    if (has(['arcade','bowling','amusement','experience'])) return 'tertiary'
  }
  return 'other'
}

function diversifiedVenueSlate<T extends { name: string; category: string; signalScore: number; ratingCount: number; distanceMiles: number }>(places: T[], slug: string, band: VenueTimeBand, limit: number): T[] {
  const ordered = [...places].sort((a,b) => b.signalScore-a.signalScore || b.ratingCount-a.ratingCount || a.distanceMiles-b.distanceMiles)
  const laneOrder: VenueLane[] = slug === 'chill' && band === 'late_night'
    ? ['primary','tertiary','social','secondary','other']
    : ['primary','secondary','tertiary','social','other']
  const picked: T[] = []
  for (const lane of laneOrder) {
    const candidate = ordered.find((place) => venueLane(slug, place.name, place.category) === lane && !picked.includes(place))
    if (candidate) picked.push(candidate)
    if (picked.length >= limit) return picked
  }
  for (const candidate of ordered) {
    if (!picked.includes(candidate)) picked.push(candidate)
    if (picked.length >= limit) break
  }
  return picked
}

function facilityFit(slug: string, name: string, category: string, localHour: number) {
  const text = `${name} ${category}`.toLowerCase()
  const band = timeBandFor(localHour)
  const coffee = ['coffee', 'cafe', 'bakery'].some((term) => text.includes(term))
  const nightlife = ['bar', 'lounge', 'cocktail', 'pub', 'brewery', 'nightclub', 'dance club']
  const restaurant = ['restaurant', 'diner', 'food hall', 'breakfast', 'brunch']
  const indoorSport = ['basketball', 'recreation center', 'community center', 'sports complex', 'sports center', 'athletic center', 'gym', 'fitness', 'ymca']
  const outdoorSport = ['park', 'playground', 'trail', 'nature', 'outdoor']

  if (slug === 'chill') {
    if (band === 'morning') {
      if (text.includes('starbucks')) return 42
      if (coffee) return 20
      if (includesAny(text, nightlife)) return -14
      return 0
    }
    if (band === 'daytime' && coffee) return 14
    if (band === 'evening' && (coffee || includesAny(text, nightlife))) return 12
    if (band === 'late_night' && includesAny(text, nightlife)) return 24
    if (band === 'late_night' && coffee) return -4
    return 0
  }

  if (slug === 'food') {
    if (band === 'morning' && includesAny(text, ['breakfast', 'brunch', 'diner', 'cafe'])) return 20
    if (band === 'late_night' && includesAny(text, ['24 hour', 'late night', 'diner'])) return 20
    return includesAny(text, restaurant) ? 10 : 0
  }

  if (slug === 'drinks' || slug === 'nightlife') {
    if (includesAny(text, nightlife)) return band === 'late_night' ? 22 : 14
    if (band === 'morning' && includesAny(text, ['brunch', 'mimosa'])) return 14
    return 0
  }

  if (slug === 'sports') {
    const inside = includesAny(text, indoorSport)
    const outside = includesAny(text, outdoorSport)
    if (inside && !outside) return 25
    if (inside && outside) return 10
    if (outside) return band === 'morning' || band === 'daytime' ? 10 : -20
    return 0
  }

  if (slug === 'creative') {
    if (includesAny(text, ['paint', 'pottery', 'art studio', 'creative', 'maker'])) return band === 'evening' ? 20 : 14
    return 0
  }

  if (slug === 'music') {
    if (includesAny(text, ['live music', 'jazz', 'music venue', 'concert'])) return band === 'evening' || band === 'late_night' ? 22 : 12
    return 0
  }

  if (slug === 'outdoors') {
    if (includesAny(text, ['waterfront', 'boardwalk', 'park', 'trail', 'beach', 'outdoor'])) return band === 'late_night' ? 8 : 18
    return 0
  }

  if (slug === 'explore') {
    if (band === 'late_night' && includesAny(text, ['arcade', 'bowling', 'entertainment'])) return 22
    if (band === 'morning' || band === 'daytime') {
      if (includesAny(text, ['museum', 'market', 'attraction', 'waterfront'])) return 16
    }
    return 0
  }

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
      .select('city_id,activity_id,state,journey_stage,starts_at,ends_at')
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
    if (!existing && group.journey_stage !== 'places') {
      return json({ error: `signal_stage_mismatch:${group.journey_stage}` }, 409)
    }
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
    const signalStartsAt = new Date(group.starts_at).getTime()
    const signalEndsAt = new Date(group.ends_at).getTime()
    if (!Number.isFinite(signalStartsAt) || !Number.isFinite(signalEndsAt) || signalEndsAt <= signalStartsAt) {
      throw new Error('Signal time window is unavailable')
    }
    const nowEpoch = Date.now()
    const venueTargetEpoch = Math.max(nowEpoch, signalStartsAt)
    const localHour = cityLocalHour(city.timezone_name, venueTargetEpoch)
    if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
      throw new Error('Signal city local time is unavailable')
    }
    const searchIntent = searchIntentFor(activity.slug, activity.name, localHour)
    const query = searchIntent
    const venueTimeBand = timeBandFor(localHour)
    const minimumOpenMinutes = minimumUsableOpenMinutes(activity.slug, localHour)
    const venuePolicy = coordinationPolicy(activity.slug, venueTimeBand)
    // Late-night intent can legitimately continue across midnight. Extend only that
    // active coordination horizon; daytime/evening Signals retain their persisted window.
    const effectiveSignalEndsAt = venueTimeBand === 'late_night'
      ? Math.max(signalEndsAt, nowEpoch + LATE_NIGHT_WINDOW_FLOOR_MINUTES * 60_000)
      : signalEndsAt
    const requireOpenNow = signalStartsAt <= nowEpoch + 15 * 60_000
    const fetchRawPlaces = async (radiusMeters: number, textQuery = query) => {
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
          textQuery,
          ...(requireOpenNow ? { openNow: true } : {}),
          pageSize: 20,
          rankPreference: 'DISTANCE',
          regionCode: 'US',
          locationBias: { circle: { center: { latitude: searchLatitude, longitude: searchLongitude }, radius: radiusMeters } },
        }),
      })
      if (!googleResponse.ok) {
        throw new Error(`Google Places failed (${googleResponse.status}): ${await googleResponse.text()}`)
      }
      const googleData = await googleResponse.json()
      return (Array.isArray(googleData.places) ? googleData.places : [])
        .filter((place: { id?: unknown }) =>
          typeof place.id !== 'string' || !excludedPlaceIds.has(place.id),
        )
    }

    const scorePlaces = async (rawPlaces: unknown[], searchRadiusMiles: number) => {
      // Google Places response is runtime-validated field-by-field below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Promise.all(rawPlaces.map(async (place: any, index: number) => {
        const lat = Number(place.location?.latitude ?? 0)
        const lng = Number(place.location?.longitude ?? 0)
        const centerMiles = Number(milesBetween(searchLatitude, searchLongitude, lat, lng).toFixed(2))
        const memberDistances = travelLocations.map((point) =>
          milesBetween(point.latitude, point.longitude, lat, lng),
        )
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
        const openMinutesRemaining = openNow === true ? minutesUntilCurrentClose(place, nowEpoch) : null
        const supportsSignalWindow = hasUsableSignalSlot(
          signalStartsAt, effectiveSignalEndsAt, place, venuePolicy, nowEpoch,
        )
        const hasMinimumOpenTime = openNow === true
          ? openMinutesRemaining !== null && openMinutesRemaining >= minimumOpenMinutes
          : openNow === false ? false : supportsSignalWindow
        const category = place.primaryType ?? activity.slug
        const photo = place.photos?.[0] ?? null
        const photoName = typeof photo?.name === 'string' ? photo.name : null
        const relevance = rawPlaces.length <= 1
          ? 10
          : Number((10 * (1 - index / (rawPlaces.length - 1))).toFixed(2))
        const fit = facilityFit(activity.slug, place.displayName?.text ?? '', category, localHour)
        const travelScore = groupTravelAverageMiles !== null && groupTravelMaxMiles !== null
          ? fairTravelScore(groupTravelAverageMiles, groupTravelMaxMiles)
          : distanceScore(centerMiles)
        const score = travelScore + ratingScore(rating) + confidenceScore(ratingCount) +
          (openNow === true ? 10 : openNow === null ? 5 : 0) + relevance + fit

        return {
          placeId: place.id ?? '',
          name: place.displayName?.text ?? 'Unknown place',
          address: place.formattedAddress ?? '',
          lat,
          lng,
          distanceMiles: miles,
          groupTravelAverageMiles: groupTravelAverageMiles ?? undefined,
          groupTravelMaxMiles: groupTravelMaxMiles ?? undefined,
          activitySlug: activity.slug,
          meetingPointMode: hasGroupMeetingPoint ? 'group_midpoint' : 'city_center',
          locationMemberCount: validMemberLocations.length,
          activeMemberCount: activeUserIds.length,
          venueTimeBand,
          minimumOpenMinutes,
          requireOpenNow,
          searchRadiusMiles,
          rating,
          ratingCount,
          category,
          openNow,
          openMinutesRemaining,
          supportsSignalWindow,
          hasMinimumOpenTime,
          utcOffsetMinutes: typeof place.utcOffsetMinutes === 'number' ? place.utcOffsetMinutes : null,
          openingHours: place.currentOpeningHours ? {
            periods: Array.isArray(place.currentOpeningHours.periods)
              ? place.currentOpeningHours.periods : [],
            weekdayDescriptions: Array.isArray(place.currentOpeningHours.weekdayDescriptions)
              ? place.currentOpeningHours.weekdayDescriptions.filter((x: unknown) => typeof x === 'string')
              : [],
          } : null,
          photoName,
          photoUrl: await placePhotoUrl(apiKey, photoName),
          photoAttributions: Array.isArray(photo?.authorAttributions)
            ? photo.authorAttributions.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (a: any) => ({
                displayName: typeof a.displayName === 'string' ? a.displayName : 'Google Maps contributor',
                uri: typeof a.uri === 'string' ? a.uri : null,
                photoUri: typeof a.photoUri === 'string' ? a.photoUri : null,
              }),
            )
            : [],
          googleMapsUri: typeof place.googleMapsUri === 'string' ? place.googleMapsUri : null,
          reviews: Array.isArray(place.reviews)
            ? place.reviews.slice(0, 3).map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (review: any) => ({
                rating: typeof review.rating === 'number' ? review.rating : 0,
                text: typeof review.text?.text === 'string' ? review.text.text : '',
                relativeTime: typeof review.relativePublishTimeDescription === 'string'
                  ? review.relativePublishTimeDescription : null,
                authorName: typeof review.authorAttribution?.displayName === 'string'
                  ? review.authorAttribution.displayName : 'Google Maps user',
                authorPhotoUrl: typeof review.authorAttribution?.photoUri === 'string'
                  ? review.authorAttribution.photoUri : null,
                authorUri: typeof review.authorAttribution?.uri === 'string'
                  ? review.authorAttribution.uri : null,
                googleMapsUri: typeof review.googleMapsUri === 'string'
                  ? review.googleMapsUri : null,
              }),
            ).filter((review: { text: string }) => review.text.length > 0)
            : [],
          signalRank: 0,
          signalScore: Number(score.toFixed(2)),
          scoreBreakdown: {
            distance: travelScore,
            rating: ratingScore(rating),
            confidence: confidenceScore(ratingCount),
            availability: openNow === true ? 10 : openNow === null ? 5 : 0,
            relevance,
            facilityFit: fit,
            localHour,
          },
        }
      }))
    }

    let searchRadiusMiles = 12
    let rawPlaces = await fetchRawPlaces(19312.1)
    let places = await scorePlaces(rawPlaces, searchRadiusMiles)
    let eligiblePlaces = places.filter((place) =>
      place.placeId.length > 0 && place.supportsSignalWindow && place.hasMinimumOpenTime &&
      (!requireOpenNow || place.openNow === true),
    )

    if (eligiblePlaces.length < 2) {
      searchRadiusMiles = 17
      rawPlaces = await fetchRawPlaces(27358.8)
      places = await scorePlaces(rawPlaces, searchRadiusMiles)
      eligiblePlaces = places.filter((place) =>
        place.placeId.length > 0 && place.supportsSignalWindow && place.hasMinimumOpenTime &&
        (!requireOpenNow || place.openNow === true),
      )
    }

    // A broad Places text search can collapse a category into only one or two Google
    // result types. If that happens, deliberately source additional experience lanes,
    // then dedupe by Google place id before applying the same availability/quality gates.
    if (eligiblePlaces.length < 3) {
      const supplementalBatches = await Promise.all(
        supplementalSearchIntents(activity.slug, venueTimeBand)
          .map((intent) => fetchRawPlaces(searchRadiusMiles * 1609.34, intent)),
      )
      const mergedByPlaceId = new Map<string, unknown>()
      for (const place of [...rawPlaces, ...supplementalBatches.flat()]) {
        const placeId = typeof (place as { id?: unknown })?.id === 'string'
          ? (place as { id: string }).id : ''
        if (placeId && !mergedByPlaceId.has(placeId)) mergedByPlaceId.set(placeId, place)
      }
      rawPlaces = [...mergedByPlaceId.values()]
      places = await scorePlaces(rawPlaces, searchRadiusMiles)
      eligiblePlaces = places.filter((place) =>
        place.placeId.length > 0 && place.supportsSignalWindow && place.hasMinimumOpenTime &&
        (!requireOpenNow || place.openNow === true),
      )
    }

    const slateSize = Math.min(Math.max(limit, 2), 3)
    // Every activity returns a deliberately varied slate when eligible inventory allows it.
    // Ranking still chooses the best candidate inside each experience lane.
    const slate = diversifiedVenueSlate(eligiblePlaces, activity.slug, venueTimeBand, slateSize)
    const ranked = slate.map((place, index) => ({ ...place, signalRank: index + 1 }))

    // A Signal only needs one genuinely usable venue to keep coordination moving.
    // Requiring two candidates turned a healthy single-option result into a dead-end,
    // even though the database can deterministically lock the only viable choice.
    if (ranked.length === 0) {
      return json({
        error: 'No open venue has a usable meetup time in this Signal window',
        diagnostics: {
          activity: activity.slug,
          venueTimeBand,
          requireOpenNow,
          rawCandidateCount: rawPlaces.length,
          openCandidateCount: places.filter((place) => place.openNow === true).length,
          windowCompatibleCount: places.filter((place) => place.supportsSignalWindow).length,
          minimumOpenTimeCount: places.filter((place) => place.hasMinimumOpenTime).length,
          usableCandidateCount: eligiblePlaces.length,
          policy: venuePolicy,
          minimumOpenMinutes,
          lateNightWindowFloorMinutes: venueTimeBand === 'late_night' ? LATE_NIGHT_WINDOW_FLOOR_MINUTES : null,
          signalEndsAt: new Date(signalEndsAt).toISOString(),
          effectiveSignalEndsAt: new Date(effectiveSignalEndsAt).toISOString(),
          searchRadiusMiles,
        },
      }, 409)
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
