import { supabase } from '../../../lib/supabaseClient'
import type { SignalTimesResponse } from './contract'

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return 'Signal time coordination failed'
  const candidate = error as { message?: unknown; context?: unknown }
  const fallback = typeof candidate.message === 'string' && candidate.message.trim()
    ? candidate.message
    : 'Signal time coordination failed'

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

export async function fetchSignalTimes(
  signalGroupId: string,
): Promise<SignalTimesResponse> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error('Unable to verify your Signal session')
  if (!session) throw new Error('You must be signed in to coordinate a Signal time')

  const { data, error } = await supabase.functions.invoke('signal-times', {
    body: { signalGroupId },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  if (!data || typeof data !== 'object') throw new Error('Signal time coordination returned an invalid response')
  return data as SignalTimesResponse
}

const TIME_MUTATION_TIMEOUT_MS = 12_000
const TIME_MUTATION_RETRY_DELAY_MS = 250
const TIME_MUTATION_MAX_ATTEMPTS = 2

export async function submitSignalTimeAvailability(
  roundId: string,
  availableOptionIds: string[],
  preferredOptionId: string | null = null,
): Promise<void> {
  let lastMessage = 'Unable to submit your available times'

  for (let attempt = 0; attempt < TIME_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), TIME_MUTATION_TIMEOUT_MS)

    try {
      const { error, status } = await supabase
        .rpc('submit_my_signal_time_availability', {
          p_round_id: roundId,
          p_available_option_ids: availableOptionIds,
          p_preferred_option_id: preferredOptionId,
        })
        .abortSignal(controller.signal)

      if (!error) return
      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= TIME_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, TIME_MUTATION_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}

export async function reconcileSignalTimeRound(roundId: string): Promise<void> {
  const { error } = await supabase.rpc('reconcile_my_signal_time_round', {
    p_round_id: roundId,
  })
  if (error) throw new Error(error.message || 'Unable to finish time coordination')
}

export function subscribeToSignalTimeRound(
  signalGroupId: string,
  onInvalidate: () => void,
): () => void {
  const channel = supabase
    .channel(`signal-time:${signalGroupId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_time_rounds',
      filter: `signal_group_id=eq.${signalGroupId}`,
    }, onInvalidate)
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}

export type SignalVenueRecoveryReason =
  | 'closed'
  | 'no_eligible_time'
  | 'unavailable'

export async function recoverSignalVenue(
  signalGroupId: string,
  failedPlaceId: string,
  reason: SignalVenueRecoveryReason,
): Promise<void> {
  let lastMessage = 'Unable to find another Signal venue'

  for (let attempt = 0; attempt < TIME_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), TIME_MUTATION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('recover_my_signal_venue', {
          p_signal_group_id: signalGroupId,
          p_failed_place_id: failedPlaceId,
          p_reason: reason,
        })
        .abortSignal(controller.signal)

      if (!error) {
        if (data !== true) throw new Error('Signal venue recovery returned an invalid response')
        return
      }

      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= TIME_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, TIME_MUTATION_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}
