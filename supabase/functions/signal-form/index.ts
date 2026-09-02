import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SignalFormRequest = {
  citySlug: string
  activitySlug: string
  timeWindow:
    | 'NOW'
    | 'TONIGHT'
    | 'TOMORROW'
    | 'THIS_WEEKEND'
  crowdMode: 'everyone' | 'women_only' | 'men_only'
  minAge: number | null
  maxAge: number | null
  journeyOrigin:
    | 'direct_signal'
    | 'im_bored'
    | 'manual_plan'
  vibeId?: string | null
  preferredRadiusMiles?: number | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (
  body: unknown,
  status = 200,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  const parseDefaultHostedKey = (
    environmentName: string,
  ): string | null => {
    const rawValue = Deno.env.get(environmentName)

    if (!rawValue) {
      return null
    }

    try {
      const parsed = JSON.parse(rawValue)

      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.default === 'string' &&
        parsed.default.trim().length > 0
      ) {
        return parsed.default
      }
    } catch {
      return null
    }

    return null
  }

  const publishableKey =
    parseDefaultHostedKey('SUPABASE_PUBLISHABLE_KEYS') ??
    Deno.env.get('SUPABASE_ANON_KEY')

  const serverSecretKey =
    parseDefaultHostedKey('SUPABASE_SECRET_KEYS') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (
    !supabaseUrl ||
    !publishableKey ||
    !serverSecretKey
  ) {
    console.error(
      'signal-form server configuration is incomplete',
    )

    return jsonResponse(
      { error: 'Server configuration error' },
      500,
    )
  }

  const authorization =
    request.headers.get('Authorization')

  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    return jsonResponse(
      { error: 'Authentication required' },
      401,
    )
  }

  /*
   * Authentication boundary:
   *
   * The caller's bearer token establishes identity.
   * The browser never supplies p_user_id.
   */
  const authClient = createClient(
    supabaseUrl,
    publishableKey,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser()

  if (userError || !user) {
    return jsonResponse(
      { error: 'Invalid or expired authentication' },
      401,
    )
  }

  let rawBody: unknown

  try {
    rawBody = await request.json()
  } catch {
    return jsonResponse(
      { error: 'Invalid JSON body' },
      400,
    )
  }

  if (
    rawBody === null ||
    typeof rawBody !== 'object' ||
    Array.isArray(rawBody)
  ) {
    return jsonResponse(
      { error: 'JSON body must be an object' },
      400,
    )
  }

  const body = rawBody as Partial<SignalFormRequest>

  const {
    citySlug,
    activitySlug,
    timeWindow,
    crowdMode,
    minAge,
    maxAge,
    journeyOrigin,
    vibeId = null,
    preferredRadiusMiles = null,
  } = body

  if (
    typeof citySlug !== 'string' ||
    citySlug.trim().length === 0
  ) {
    return jsonResponse(
      { error: 'citySlug is required' },
      400,
    )
  }

  if (
    typeof activitySlug !== 'string' ||
    activitySlug.trim().length === 0
  ) {
    return jsonResponse(
      { error: 'activitySlug is required' },
      400,
    )
  }

  if (
    ![
      'NOW',
      'TONIGHT',
      'TOMORROW',
      'THIS_WEEKEND',
    ].includes(timeWindow ?? '')
  ) {
    return jsonResponse(
      { error: 'Invalid timeWindow' },
      400,
    )
  }

  if (
    ![
      'everyone',
      'women_only',
      'men_only',
    ].includes(crowdMode ?? '')
  ) {
    return jsonResponse(
      { error: 'Invalid crowdMode' },
      400,
    )
  }

  if (
    minAge !== null &&
    minAge !== undefined &&
    (
      !Number.isInteger(minAge) ||
      minAge < 18
    )
  ) {
    return jsonResponse(
      { error: 'Invalid minAge' },
      400,
    )
  }

  if (
    maxAge !== null &&
    maxAge !== undefined &&
    (
      !Number.isInteger(maxAge) ||
      maxAge < 18
    )
  ) {
    return jsonResponse(
      { error: 'Invalid maxAge' },
      400,
    )
  }

  if (
    minAge !== null &&
    minAge !== undefined &&
    maxAge !== null &&
    maxAge !== undefined &&
    maxAge < minAge
  ) {
    return jsonResponse(
      { error: 'maxAge cannot be below minAge' },
      400,
    )
  }

  if (
    ![
      'direct_signal',
      'im_bored',
      'manual_plan',
    ].includes(journeyOrigin ?? '')
  ) {
    return jsonResponse(
      { error: 'Invalid journeyOrigin' },
      400,
    )
  }

  if (
    vibeId !== null &&
    !isUuid(vibeId)
  ) {
    return jsonResponse(
      { error: 'vibeId must be null or a UUID' },
      400,
    )
  }

  if (
    preferredRadiusMiles !== null &&
    (
      typeof preferredRadiusMiles !== 'number' ||
      !Number.isFinite(preferredRadiusMiles) ||
      preferredRadiusMiles <= 0
    )
  ) {
    return jsonResponse(
      { error: 'Invalid preferredRadiusMiles' },
      400,
    )
  }

  /*
   * Privileged domain boundary.
   *
   * PostgreSQL now owns:
   *   catalog UUID resolution
   *   city timezone
   *   concrete operational timestamps
   *   activity minimum age
   *   effective minimum age
   *   grouping policy/version
   *   named-window identity
   *   named-window concurrency serialization
   *
   * p_user_id remains derived exclusively from auth.getUser().
   */
  const domainClient = createClient(
    supabaseUrl,
    serverSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const { data, error } = await domainClient.rpc(
    'resolve_and_form_signal',
    {
      p_user_id: user.id,
      p_city_slug: citySlug.trim().toLowerCase(),
      p_activity_slug:
        activitySlug.trim().toLowerCase(),
      p_time_window: timeWindow,
      p_crowd_mode: crowdMode,
      p_min_age: minAge ?? null,
      p_max_age: maxAge ?? null,
      p_journey_origin: journeyOrigin,
      p_vibe_id: vibeId,
      p_preferred_radius_miles:
        preferredRadiusMiles,
    },
  )

  if (error) {
    console.error(
      'resolve_and_form_signal failed',
      {
        code: error.code,
        message: error.message,
      },
    )

    return jsonResponse(
      {
        error: 'Signal formation failed',
        code: error.code ?? null,
      },
      400,
    )
  }

  const result =
    Array.isArray(data) ? data[0] : data

  if (!result) {
    console.error(
      'resolve_and_form_signal returned no result',
    )

    return jsonResponse(
      { error: 'Signal formation returned no result' },
      500,
    )
  }

  return jsonResponse({
    signalIntentId:
      result.signal_intent_id,
    signalGroupId:
      result.signal_group_id,
    groupState:
      result.group_state,
    memberCount:
      result.member_count,
    activationThreshold:
      result.activation_threshold,
  })
})
