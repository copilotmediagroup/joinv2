import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type SignalFormRequest = {
  cityId: string
  activityId: string
  startsAt: string
  endsAt: string
  crowdMode: 'everyone' | 'women_only' | 'men_only'
  minAge: number | null
  maxAge: number | null
  groupingPolicyCode: string
  journeyOrigin: 'direct_signal' | 'im_bored' | 'manual_plan'
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

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  !Number.isNaN(Date.parse(value))

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
   * Authentication client:
   * use the caller's bearer token only to establish identity.
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

  const body = rawBody as SignalFormRequest

  const {
    cityId,
    activityId,
    startsAt,
    endsAt,
    crowdMode,
    minAge,
    maxAge,
    groupingPolicyCode,
    journeyOrigin,
    vibeId = null,
    preferredRadiusMiles = null,
  } = body

  if (!isUuid(cityId)) {
    return jsonResponse(
      { error: 'cityId must be a UUID' },
      400,
    )
  }

  if (!isUuid(activityId)) {
    return jsonResponse(
      { error: 'activityId must be a UUID' },
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
    !isIsoDate(startsAt) ||
    !isIsoDate(endsAt)
  ) {
    return jsonResponse(
      {
        error:
          'startsAt and endsAt must be valid timestamps',
      },
      400,
    )
  }

  if (
    ![
      'everyone',
      'women_only',
      'men_only',
    ].includes(crowdMode)
  ) {
    return jsonResponse(
      { error: 'Invalid crowdMode' },
      400,
    )
  }

  if (
    minAge !== null &&
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
    maxAge !== null &&
    maxAge < minAge
  ) {
    return jsonResponse(
      { error: 'maxAge cannot be below minAge' },
      400,
    )
  }

  if (
    typeof groupingPolicyCode !== 'string' ||
    groupingPolicyCode.trim().length === 0
  ) {
    return jsonResponse(
      { error: 'groupingPolicyCode is required' },
      400,
    )
  }

  if (
    ![
      'direct_signal',
      'im_bored',
      'manual_plan',
    ].includes(journeyOrigin)
  ) {
    return jsonResponse(
      { error: 'Invalid journeyOrigin' },
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
   * Privileged database client.
   *
   * The service-role credential exists only inside the Edge
   * Function environment. It is never returned to the browser.
   *
   * Most importantly, p_user_id comes from auth.getUser().
   * There is intentionally no userId field in SignalFormRequest.
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
    'form_or_join_signal',
    {
      p_user_id: user.id,
      p_city_id: cityId,
      p_activity_id: activityId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_crowd_mode: crowdMode,
      p_min_age: minAge,
      p_max_age: maxAge,
      p_grouping_policy_code:
        groupingPolicyCode.trim(),
      p_journey_origin: journeyOrigin,
      p_vibe_id: vibeId,
      p_preferred_radius_miles:
        preferredRadiusMiles,
    },
  )

  if (error) {
    console.error(
      'form_or_join_signal failed',
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
      'form_or_join_signal returned no result',
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
