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

export async function fetchSignalPlaces(
  request: SignalPlacesRequest,
): Promise<SignalPlacesResponse> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error('Unable to verify your Signal session')
  if (!session) throw new Error('You must be signed in to choose a Signal venue')

  const { data, error } = await supabase.functions.invoke('signal-places', { body: request })
  if (error) throw new Error(error.message || 'Signal Places request failed')
  if (!data || typeof data !== 'object') throw new Error('Signal Places returned an invalid response')
  return data as SignalPlacesResponse
}

export async function castSignalVenueVote(
  roundId: string,
  optionId: string,
): Promise<SignalVenueVoteResult> {
  const { data, error } = await supabase.rpc('cast_my_signal_venue_vote', {
    p_round_id: roundId,
    p_option_id: optionId,
  })
  if (error) throw new Error(error.message || 'Unable to cast your venue vote')
  const row = requireRpcRow(data, 'Venue vote')
  return {
    voteAccepted: row.vote_accepted === true,
    roundState: String(row.round_state) as SignalVenueVoteResult['roundState'],
    winnerOptionId: typeof row.winner_option_id === 'string' ? row.winner_option_id : null,
  }
}

export async function reconcileSignalVenueRound(
  roundId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reconcile_my_signal_venue_round', {
    p_round_id: roundId,
  })
  if (error) throw new Error(error.message || 'Unable to reconcile venue voting')
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
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_venue_votes',
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_venue_options',
    }, onInvalidate)
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
