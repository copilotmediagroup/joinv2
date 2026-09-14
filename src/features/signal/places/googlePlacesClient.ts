import { supabase } from '../../../lib/supabaseClient'
import type {
  SignalPlacesRequest,
  SignalPlacesResponse,
  SignalVenueVoteResult,
} from './contract'

function requireRpcRow(
  value: unknown,
  operation: string,
): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') {
    throw new Error(`${operation} returned an invalid response`)
  }
  return value[0] as Record<string, unknown>
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return 'Signal Places request failed'

  const candidate = error as { message?: unknown; context?: unknown }
  const fallback = typeof candidate.message === 'string' && candidate.message.trim()
    ? candidate.message
    : 'Signal Places request failed'

  if (candidate.context instanceof Response) {
    try {
      const payload = await candidate.context.clone().json() as { error?: unknown }
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error
    } catch {
      try {
        const text = await candidate.context.clone().text()
        if (text.trim()) return text.trim()
      } catch {
        // Fall through to the SDK message.
      }
    }
  }

  return fallback
}

export class SignalGroupLocationPendingError extends Error {
  constructor() {
    super('group_location_pending')
    this.name = 'SignalGroupLocationPendingError'
  }
}

export async function submitMySignalLocation(signalGroupId: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
    )
  })
  if (!position) return false

  const { error } = await supabase.rpc('set_my_signal_location', {
    p_signal_group_id: signalGroupId,
    p_latitude: position.coords.latitude,
    p_longitude: position.coords.longitude,
    p_accuracy_meters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    p_captured_at: new Date(position.timestamp).toISOString(),
  })
  if (error) return false
  return true
}

export async function fetchSignalPlaces(
  request: SignalPlacesRequest,
): Promise<SignalPlacesResponse> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error('Unable to verify your Signal session')
  if (!session) throw new Error('You must be signed in to choose a Signal venue')

  const { data, error } = await supabase.functions.invoke('signal-places', { body: request })
  if (error) {
    const message = await getFunctionErrorMessage(error)
    if (message.includes('group_location_pending')) throw new SignalGroupLocationPendingError()
    throw new Error(message)
  }
  if (!data || typeof data !== 'object') throw new Error('Signal Places returned an invalid response')
  return data as SignalPlacesResponse
}

const COORDINATION_MUTATION_TIMEOUT_MS = 12_000
const COORDINATION_MUTATION_RETRY_DELAY_MS = 250
const COORDINATION_MUTATION_MAX_ATTEMPTS = 2

function coordinationDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function castSignalVenueVote(
  roundId: string,
  optionId: string,
): Promise<SignalVenueVoteResult> {
  let lastMessage = 'Unable to cast your venue vote'

  for (let attempt = 0; attempt < COORDINATION_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), COORDINATION_MUTATION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('cast_my_signal_venue_vote', { p_round_id: roundId, p_option_id: optionId })
        .abortSignal(controller.signal)

      if (!error) {
        const row = requireRpcRow(data, 'Venue vote')
        return {
          voteAccepted: row.vote_accepted === true,
          roundState: String(row.round_state) as SignalVenueVoteResult['roundState'],
          winnerOptionId: typeof row.winner_option_id === 'string' ? row.winner_option_id : null,
        }
      }

      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= COORDINATION_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await coordinationDelay(COORDINATION_MUTATION_RETRY_DELAY_MS)
  }

  throw new Error(lastMessage)
}

export async function reconcileSignalVenueRound(
  roundId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reconcile_my_signal_venue_round', {
    p_round_id: roundId,
  })
  if (error) throw new Error(error.message || 'Unable to reconcile venue voting')
}

export async function restartDeadlockedSignalVenueVote(
  signalGroupId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('restart_my_deadlocked_signal_venue_vote', {
    p_signal_group_id: signalGroupId,
  })
  if (error) throw new Error(error.message || 'Unable to restart venue voting')
  return data === true
}

export function subscribeToSignalVenueRound(
  signalGroupId: string,
  onInvalidate: () => void,
): () => void {
  const channel = supabase
    .channel(`signal-venue:${signalGroupId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_venue_rounds',
      filter: `signal_group_id=eq.${signalGroupId}`,
    }, onInvalidate)
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
