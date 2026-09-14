import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js'

import { supabase } from '../../../lib/supabaseClient'

const FORMATION_TIMEOUT_MS = 12_000
const FORMATION_RETRY_DELAY_MS = 250
const FORMATION_MAX_ATTEMPTS = 2

export type SignalTimeWindow =
  | 'NOW'
  | 'TONIGHT'
  | 'TOMORROW'
  | 'THIS_WEEKEND'

export type SignalFormationCrowdMode =
  | 'everyone'
  | 'women_only'
  | 'men_only'

export type SignalFormationRequest = {
  citySlug: string
  activitySlug: string
  timeWindow: SignalTimeWindow
  crowdMode: SignalFormationCrowdMode
  minAge: number | null
  maxAge: number | null
  journeyOrigin:
    | 'direct_signal'
    | 'im_bored'
    | 'manual_plan'
  vibeId?: string | null
  preferredRadiusMiles?: number | null
}

export type SignalFormationResult = {
  signalIntentId: string
  signalGroupId: string
  groupState:
    | 'forming'
    | 'confirming'
    | 'coordinating'
    | 'locked'
    | 'active_outing'
    | 'completed'
    | 'cancelled'
    | 'expired'
  memberCount: number
  activationThreshold: number
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Signal formation response missing ${field}`,
    )
  }

  return value
}

function requireNumber(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    throw new Error(
      `Signal formation response missing ${field}`,
    )
  }

  return value
}

function parseFormationResult(
  value: unknown,
): SignalFormationResult {
  if (!isRecord(value)) {
    throw new Error(
      'Signal formation returned an invalid response',
    )
  }

  const groupState =
    requireString(
      value.groupState,
      'groupState',
    ) as SignalFormationResult['groupState']

  const validStates =
    new Set<SignalFormationResult['groupState']>([
      'forming',
      'confirming',
      'coordinating',
      'locked',
      'active_outing',
      'completed',
      'cancelled',
      'expired',
    ])

  if (!validStates.has(groupState)) {
    throw new Error(
      'Signal formation returned an invalid groupState',
    )
  }

  return {
    signalIntentId:
      requireString(
        value.signalIntentId,
        'signalIntentId',
      ),
    signalGroupId:
      requireString(
        value.signalGroupId,
        'signalGroupId',
      ),
    groupState,
    memberCount:
      requireNumber(
        value.memberCount,
        'memberCount',
      ),
    activationThreshold:
      requireNumber(
        value.activationThreshold,
        'activationThreshold',
      ),
  }
}

async function getFunctionErrorMessage(
  error: unknown,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload =
        await error.context.json()

      if (
        isRecord(payload) &&
        typeof payload.error === 'string'
      ) {
        return payload.error
      }

      if (
        isRecord(payload) &&
        typeof payload.message === 'string'
      ) {
        return payload.message
      }
    } catch {
      return 'Signal formation request failed'
    }

    return 'Signal formation request failed'
  }

  if (error instanceof FunctionsRelayError) {
    return 'Signal formation service is unavailable'
  }

  if (error instanceof FunctionsFetchError) {
    return 'Unable to reach Signal formation service'
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Signal formation request failed'
}

function isRetryableFormationError(error: unknown): boolean {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return true
  }

  return error instanceof FunctionsHttpError && error.context.status >= 500
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function formSignal(
  request: SignalFormationRequest,
): Promise<SignalFormationResult> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    throw new Error('Unable to verify your Signal session')
  }
  if (!session) {
    throw new Error('You must be signed in to join a Signal')
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt < FORMATION_MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.functions.invoke('signal-form', {
      body: request,
      timeout: FORMATION_TIMEOUT_MS,
    })

    if (!error) return parseFormationResult(data)
    lastError = error

    if (attempt + 1 >= FORMATION_MAX_ATTEMPTS || !isRetryableFormationError(error)) {
      break
    }

    await delay(FORMATION_RETRY_DELAY_MS)
  }

  throw new Error(await getFunctionErrorMessage(lastError))
}
