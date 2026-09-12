import { supabase } from '../../../lib/supabaseClient'
import type { SignalTimesResponse } from './contract'

export async function fetchSignalTimes(
  signalGroupId: string,
): Promise<SignalTimesResponse> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error('Unable to verify your Signal session')
  if (!session) throw new Error('You must be signed in to coordinate a Signal time')

  const { data, error } = await supabase.functions.invoke('signal-times', {
    body: { signalGroupId },
  })
  if (error) throw new Error(error.message || 'Signal time coordination failed')
  if (!data || typeof data !== 'object') throw new Error('Signal time coordination returned an invalid response')
  return data as SignalTimesResponse
}

export async function submitSignalTimeAvailability(
  roundId: string,
  availableOptionIds: string[],
  preferredOptionId: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('submit_my_signal_time_availability', {
    p_round_id: roundId,
    p_available_option_ids: availableOptionIds,
    p_preferred_option_id: preferredOptionId,
  })
  if (error) throw new Error(error.message || 'Unable to submit your available times')
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
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_time_options',
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_time_availability',
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
  const { data, error } = await supabase.rpc('recover_my_signal_venue', {
    p_signal_group_id: signalGroupId,
    p_failed_place_id: failedPlaceId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message || 'Unable to find another Signal venue')
  if (data !== true) throw new Error('Signal venue recovery returned an invalid response')
}
