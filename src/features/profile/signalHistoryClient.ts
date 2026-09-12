import { supabase } from '../../lib/supabaseClient'

export type SignalHistorySummary = {
  signalsJoined: number
  completedMeetups: number
  verifiedShowUps: number
  lastMeetupAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

export async function getMySignalHistorySummary(): Promise<SignalHistorySummary> {
  const { data, error } = await supabase.rpc('get_my_signal_history_summary')

  if (error) {
    throw new Error(error.message || 'Unable to load Signal history.')
  }

  if (!isRecord(data)) {
    throw new Error('Invalid Signal history response.')
  }

  return {
    signalsJoined: nonNegativeInteger(data.signalsJoined),
    completedMeetups: nonNegativeInteger(data.completedMeetups),
    verifiedShowUps: nonNegativeInteger(data.verifiedShowUps),
    lastMeetupAt:
      typeof data.lastMeetupAt === 'string' && data.lastMeetupAt.trim()
        ? data.lastMeetupAt
        : null,
  }
}
