import { supabase } from '../../lib/supabaseClient'
import type { ProfileGender } from './profileClient'

export type ChillDatingPreferences = {
  seekingGender: ProfileGender
  minAge: number
  maxAge: number
  isEnabled: boolean
}

type ChillDatingPreferencesRow = {
  seeking_gender: ProfileGender
  min_age: number
  max_age: number
  is_enabled: boolean
}

function mapRow(row: ChillDatingPreferencesRow): ChillDatingPreferences {
  return {
    seekingGender: row.seeking_gender,
    minAge: row.min_age,
    maxAge: row.max_age,
    isEnabled: row.is_enabled,
  }
}

export async function getMyChillDatingPreferences():
Promise<ChillDatingPreferences | null> {
  const { data, error } = await supabase.rpc('get_my_chill_dating_preferences')
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) return null
  return mapRow(data[0] as ChillDatingPreferencesRow)
}

export async function updateMyChillDatingPreferences(
  input: ChillDatingPreferences,
): Promise<ChillDatingPreferences> {
  const { data, error } = await supabase.rpc('update_my_chill_dating_preferences', {
    p_seeking_gender: input.seekingGender,
    p_min_age: input.minAge,
    p_max_age: input.maxAge,
    p_is_enabled: input.isEnabled,
  })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error('Chill preferences returned an unexpected result.')
  }
  return mapRow(data[0] as ChillDatingPreferencesRow)
}
