import { supabase } from '../../lib/supabaseClient'

export type SignalPreferences = {
  socialEnergy: string | null
  goingOutStyle: string | null
  nightTiming: string | null
  venueEnergy: string | null
  barStyle: string | null
  restaurantStyle: string | null
  planningStyle: string | null
  groupSize: string | null
}

const EMPTY_PREFERENCES: SignalPreferences = {
  socialEnergy: null,
  goingOutStyle: null,
  nightTiming: null,
  venueEnergy: null,
  barStyle: null,
  restaurantStyle: null,
  planningStyle: null,
  groupSize: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function parsePreferences(value: unknown): SignalPreferences {
  if (!isRecord(value)) return { ...EMPTY_PREFERENCES }
  return {
    socialEnergy: nullableString(value.socialEnergy),
    goingOutStyle: nullableString(value.goingOutStyle),
    nightTiming: nullableString(value.nightTiming),
    venueEnergy: nullableString(value.venueEnergy),
    barStyle: nullableString(value.barStyle),
    restaurantStyle: nullableString(value.restaurantStyle),
    planningStyle: nullableString(value.planningStyle),
    groupSize: nullableString(value.groupSize),
  }
}

export async function getMySignalPreferences(): Promise<SignalPreferences> {
  const { data, error } = await supabase.rpc('get_my_signal_preferences')
  if (error) throw new Error(error.message || 'Unable to load your Signal energy.')
  return parsePreferences(data)
}

export async function updateMySignalPreferences(
  preferences: SignalPreferences,
): Promise<SignalPreferences> {
  const { data, error } = await supabase.rpc('update_my_signal_preferences', {
    p_social_energy: preferences.socialEnergy,
    p_going_out_style: preferences.goingOutStyle,
    p_night_timing: preferences.nightTiming,
    p_venue_energy: preferences.venueEnergy,
    p_bar_style: preferences.barStyle,
    p_restaurant_style: preferences.restaurantStyle,
    p_planning_style: preferences.planningStyle,
    p_group_size: preferences.groupSize,
  })
  if (error) throw new Error(error.message || 'Unable to save your Signal energy.')
  return parsePreferences(data)
}
