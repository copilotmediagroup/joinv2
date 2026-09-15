import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type RequestBody = { signalGroupId: string }
type DomainClient = ReturnType<typeof createClient>
type VenuePayload = {
  activitySlug?: string
  venueTimeBand?: 'morning' | 'daytime' | 'evening' | 'late_night'
  openingHours?: {
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number } | null
      close?: { day?: number; hour?: number; minute?: number } | null
    }>
  } | null
  utcOffsetMinutes?: number | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const WEEK_MINUTES = 7 * 24 * 60

type CoordinationPolicy = {
  leadMinutes: number
  durationMinutes: number
  closingBufferMinutes: number
  alignmentMinutes: number
}

function coordinationPolicy(venue: VenuePayload): CoordinationPolicy {
  if (venue.venueTimeBand === 'late_night') {
    return { leadMinutes: 15, durationMinutes: 60, closingBufferMinutes: 5, alignmentMinutes: 15 }
  }
  if (venue.activitySlug === 'sports' || venue.activitySlug === 'creative') {
    return { leadMinutes: 20, durationMinutes: 90, closingBufferMinutes: 15, alignmentMinutes: 30 }
  }
  return { leadMinutes: 20, durationMinutes: 75, closingBufferMinutes: 15, alignmentMinutes: 15 }
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
  } catch { return null }
}
function alignVenueTime(epochMs: number, offsetMinutes: number, alignmentMinutes: number): number {
  const localMs = epochMs + offsetMinutes * 60_000
  const step = alignmentMinutes * 60_000
  return Math.ceil(localMs / step) * step - offsetMinutes * 60_000
}
function venueWeekMinute(epochMs: number, offsetMinutes: number): number {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  return local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes()
}
function fitsOpeningHours(
  epochMs: number,
  offsetMinutes: number,
  periods: NonNullable<NonNullable<VenuePayload['openingHours']>['periods']>,
  durationMinutes: number,
  closingBufferMinutes: number,
) {
  const candidate = venueWeekMinute(epochMs, offsetMinutes)
  const requiredEnd = candidate + durationMinutes + closingBufferMinutes

  return periods.some((period) => {
    if (!period.open) return false
    const open = (period.open.day ?? 0) * 1440 + (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0)
    let close: number
    if (!period.close) {
      close = open + WEEK_MINUTES
    } else {
      close = (period.close.day ?? 0) * 1440 + (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
      if (close <= open) close += WEEK_MINUTES
    }
    return (
      (candidate >= open && requiredEnd <= close) ||
      (candidate + WEEK_MINUTES >= open && requiredEnd + WEEK_MINUTES <= close)
    )
  })
}
function labelTime(epochMs: number, offsetMinutes: number) {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  const hour24 = local.getUTCHours()
  const minute = local.getUTCMinutes()
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`
}
function buildOptions(
  startsAt: string,
  endsAt: string,
  venue: VenuePayload,
) {
  const offset = typeof venue.utcOffsetMinutes === 'number' ? venue.utcOffsetMinutes : null
  const periods = venue.openingHours?.periods
  if (offset === null || !Array.isArray(periods) || periods.length === 0) return []

  const signalStart = new Date(startsAt).getTime()
  const signalEnd = new Date(endsAt).getTime()
  if (!Number.isFinite(signalStart) || !Number.isFinite(signalEnd)) return []

  const policy = coordinationPolicy(venue)
  const earliest = alignVenueTime(
    Math.max(signalStart, Date.now() + policy.leadMinutes * 60_000),
    offset,
    policy.alignmentMinutes,
  )
  const latest = signalEnd - policy.durationMinutes * 60_000
  const candidates: number[] = []

  for (let candidate = earliest; candidate <= latest; candidate += policy.alignmentMinutes * 60_000) {
    if (fitsOpeningHours(
      candidate, offset, periods, policy.durationMinutes, policy.closingBufferMinutes,
    )) candidates.push(candidate)
  }

  let chosen = candidates
  if (candidates.length > 3) {
    const middle = candidates[Math.floor((candidates.length - 1) / 2)]
    chosen = [candidates[0], middle, candidates[candidates.length - 1]]
  }
  const labels = chosen.length === 3
    ? ['EARLIER', 'BEST FIT', 'LATER']
    : chosen.length === 2
      ? ['EARLIER', 'LATER']
      : ['BEST FIT']

  return chosen.map((epochMs, index) => ({
    startsAt: new Date(epochMs).toISOString(),
    displayTime: labelTime(epochMs, offset),
    label: labels[index],
    sourceRank: index + 1,
  }))
}

async function loadRound(client: DomainClient, groupId: string, userId: string) {
  const { data: round, error: roundError } = await client
    .from('signal_time_rounds')
    .select('id,state,opens_at,closes_at,winner_option_id,eligible_participant_count,activation_threshold')
    .eq('signal_group_id', groupId)
    .maybeSingle()
  if (roundError) throw roundError
  if (!round) return null

  const [optionsResult, availabilityResult, membersResult] = await Promise.all([
    client.from('signal_time_options')
      .select('id,starts_at,label,source_rank,payload')
      .eq('round_id', round.id)
      .order('source_rank', { ascending: true }),
    client.from('signal_time_availability')
      .select('user_id,option_id,available,is_preferred')
      .eq('round_id', round.id),
    client.from('signal_group_memberships')
      .select('user_id')
      .eq('signal_group_id', groupId)
      .eq('state', 'confirmed')
      .eq('is_active_core', true),
  ])
  if (optionsResult.error) throw optionsResult.error
  if (availabilityResult.error) throw availabilityResult.error
  if (membersResult.error) throw membersResult.error

  const eligible = new Set((membersResult.data ?? []).map((row) => row.user_id))
  const responded = new Set<string>()
  const availableCounts: Record<string, number> = {}
  const preferredCounts: Record<string, number> = {}
  const currentAvailable = new Set<string>()
  let currentPreferred: string | null = null

  for (const row of availabilityResult.data ?? []) {
    if (!eligible.has(row.user_id)) continue
    responded.add(row.user_id)
    if (row.available) availableCounts[row.option_id] = (availableCounts[row.option_id] ?? 0) + 1
    if (row.available && row.is_preferred) preferredCounts[row.option_id] = (preferredCounts[row.option_id] ?? 0) + 1
    if (row.user_id === userId && row.available) currentAvailable.add(row.option_id)
    if (row.user_id === userId && row.is_preferred) currentPreferred = row.option_id
  }

  return {
    round: {
      id: round.id,
      state: round.state,
      opensAt: round.opens_at,
      closesAt: round.closes_at,
      winnerOptionId: round.winner_option_id,
      eligibleParticipantCount: round.eligible_participant_count,
      activationThreshold: round.activation_threshold,
      respondedParticipantCount: responded.size,
      currentUserAvailableOptionIds: [...currentAvailable],
      currentUserPreferredOptionId: currentPreferred,
      availableCounts,
      preferredCounts,
    },
    options: (optionsResult.data ?? []).map((option) => ({
      optionId: option.id,
      startsAt: option.starts_at,
      label: option.label,
      sourceRank: option.source_rank,
      ...(option.payload as Record<string, unknown>),
    })),
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = hostedKey('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY')
    const serverKey = hostedKey('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publishableKey || !serverKey) throw new Error('Signal Times server configuration is incomplete')

    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid or expired authentication' }, 401)

    const { signalGroupId } = await request.json() as RequestBody
    if (!isUuid(signalGroupId)) return json({ error: 'signalGroupId must be a UUID' }, 400)

    const domain = createClient(supabaseUrl, serverKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { data: membership, error: membershipError } = await domain
      .from('signal_group_memberships')
      .select('id')
      .eq('signal_group_id', signalGroupId)
      .eq('user_id', user.id)
      .eq('state', 'confirmed')
      .eq('is_active_core', true)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return json({ error: 'Active Signal membership required' }, 403)

    const { data: group, error: groupError } = await domain
      .from('signal_groups')
      .select('state,journey_stage,starts_at,ends_at')
      .eq('id', signalGroupId)
      .single()
    if (groupError || !group) throw groupError ?? new Error('Signal group not found')
    if (!['locked', 'coordinating'].includes(group.state)) return json({ error: 'Signal is not ready for time coordination' }, 409)

    const existing = await loadRound(domain, signalGroupId, user.id)
    if (existing) return json({ version: 'signal-time-coordination-v1', status: 'ready', ...existing })
    if (group.journey_stage !== 'time') return json({ error: `signal_stage_mismatch:${group.journey_stage}` }, 409)

    const { data: venueRound, error: venueRoundError } = await domain
      .from('signal_venue_rounds')
      .select('id,winner_option_id')
      .eq('signal_group_id', signalGroupId)
      .eq('state', 'won')
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (venueRoundError) throw venueRoundError
    if (!venueRound?.winner_option_id) return json({ error: 'Winning venue required' }, 409)

    const { data: venueOption, error: venueOptionError } = await domain
      .from('signal_venue_options')
      .select('payload')
      .eq('id', venueRound.winner_option_id)
      .single()
    if (venueOptionError || !venueOption) throw venueOptionError ?? new Error('Winning venue snapshot unavailable')

    if (!group.starts_at || !group.ends_at) throw new Error('Signal time window is unavailable')
    const generated = buildOptions(group.starts_at, group.ends_at, venueOption.payload as VenuePayload)
    if (generated.length === 0) {
      // Another participant may have initialized the authoritative round while
      // this request was building its local candidate set. Re-check before
      // declaring recovery so a transient stale response cannot push the group
      // backward after valid options already exist.
      await new Promise((resolve) => setTimeout(resolve, 300))
      const concurrent = await loadRound(domain, signalGroupId, user.id)
      if (concurrent) {
        return json({ version: 'signal-time-coordination-v1', status: 'ready', ...concurrent })
      }
      return json({ version: 'signal-time-coordination-v1', status: 'no_options', round: null, options: [] })
    }

    const { error: ensureError } = await domain.rpc('ensure_signal_time_round', {
      p_signal_group_id: signalGroupId,
      p_options: generated,
    })
    if (ensureError) throw ensureError

    const persisted = await loadRound(domain, signalGroupId, user.id)
    if (!persisted) throw new Error('Signal time round could not be initialized')
    return json({ version: 'signal-time-coordination-v1', status: 'ready', ...persisted })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Unknown server error' }, 500)
  }
})
