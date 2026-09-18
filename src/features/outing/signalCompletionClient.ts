import { supabase } from '../../lib/supabaseClient'

export type SignalCompletionRating = 'good' | 'okay' | 'bad'

export type SignalCompletion = {
  planId: string
  activityName: string
  venueName: string | null
  cityName: string
  stateCode: string
  scheduledStartsAt: string | null
  scheduledEndsAt: string | null
  completedAt: string
  experienceRating: SignalCompletionRating | null
  participantCount: number
  connectionsAvailable: boolean
}

function req(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid completion response: ${field}`)
  return value
}

export async function getMySignalCompletion(planId: string): Promise<SignalCompletion> {
  const { data, error } = await supabase.rpc('get_my_signal_completion', { p_plan_id: planId })
  if (error) throw new Error(error.message || 'Unable to load Signal completion.')
  const row = Array.isArray(data) ? data[0] : null
  if (!row) throw new Error('Signal completion not found.')
  const rating = row.experience_rating
  if (rating !== null && !['good', 'okay', 'bad'].includes(rating)) throw new Error('Invalid completion rating.')
  if (typeof row.participant_count !== 'number') throw new Error('Invalid completion participant count.')
  if (typeof row.connections_available !== 'boolean') throw new Error('Invalid completion connection state.')
  return {
    planId: req(row.plan_id, 'plan_id'),
    activityName: req(row.activity_name, 'activity_name'),
    venueName: row.venue_name === null ? null : req(row.venue_name, 'venue_name'),
    cityName: req(row.city_name, 'city_name'),
    stateCode: req(row.state_code, 'state_code'),
    scheduledStartsAt: typeof row.scheduled_starts_at === 'string' ? row.scheduled_starts_at : null,
    scheduledEndsAt: typeof row.scheduled_ends_at === 'string' ? row.scheduled_ends_at : null,
    completedAt: req(row.completed_at, 'completed_at'),
    experienceRating: rating as SignalCompletionRating | null,
    participantCount: row.participant_count,
    connectionsAvailable: row.connections_available,
  }
}

export async function submitSignalCompletionFeedback(
  planId: string,
  rating: SignalCompletionRating,
): Promise<void> {
  const { error } = await supabase.rpc('submit_my_signal_completion_feedback', {
    p_plan_id: planId,
    p_rating: rating,
  })
  if (error) throw new Error(error.message || 'Unable to save Signal feedback.')
}
