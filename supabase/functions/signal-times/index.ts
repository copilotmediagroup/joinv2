import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signalCoordinationPolicy } from '../_shared/signalCoordinationPolicy.ts'
import { buildVenueTimeCandidates } from '../_shared/signalVenueAvailability.ts'

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

  const policy = signalCoordinationPolicy(venue.activitySlug, venue.venueTimeBand)
  const candidates = buildVenueTimeCandidates(
    signalStart, signalEnd, offset, periods, policy, Date.now(),
  )

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
      .select('state,journey_stage,starts_at,ends_at,activity_id')
      .eq('id', signalGroupId)
      .single()
    if (groupError || !group) throw groupError ?? new Error('Signal group not found')
    const { data: activity, error: activityError } = await domain
      .from('activities')
      .select('slug')
      .eq('id', group.activity_id)
      .single()
    if (activityError || !activity) throw activityError ?? new Error('Signal activity unavailable')

    // A finalized time round remains the authoritative read model after the
    // Signal converts to a Plan. Resume must be able to read that immutable
    // winner without reopening or mutating time coordination.
    const existing = await loadRound(domain, signalGroupId, user.id)
    if (existing) return json({ version: 'signal-time-coordination-v1', status: 'ready', ...existing })

    if (!['locked', 'coordinating'].includes(group.state)) return json({ error: 'Signal is not ready for time coordination' }, 409)
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

    // Chill is fully coordinated by SIGNAL once the reciprocal pair locks.
    // Generated options already respect the winning venue's opening hours and
    // Signal window, so prefer BEST FIT without asking two daters to poll.
    if (activity.slug === 'chill') {
      const { error: finalizeError } = await domain.rpc('finalize_chill_time_choice', {
        p_signal_group_id: signalGroupId,
      })
      if (finalizeError) throw finalizeError
    }

    const persisted = await loadRound(domain, signalGroupId, user.id)
    if (!persisted) throw new Error('Signal time round could not be initialized')
    return json({ version: 'signal-time-coordination-v1', status: 'ready', ...persisted })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Unknown server error' }, 500)
  }
})
