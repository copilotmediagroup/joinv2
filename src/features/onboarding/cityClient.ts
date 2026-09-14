import { supabase } from '../../lib/supabaseClient'

export type OnboardingCityOption = {
  id: string
  cityName: string
  citySlug: string
  stateCode: string
  stateName: string
}

type CitySearchRow = {
  id: unknown
  city_name: unknown
  city_slug: unknown
  state_code: unknown
  state_name: unknown
}

export async function searchOnboardingCities(
  query: string,
  limit = 20,
): Promise<OnboardingCityOption[]> {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length < 2) {
    return []
  }

  const safeLimit = Math.max(1, Math.min(limit, 50))
  const { data, error } = await supabase.rpc('search_onboarding_cities', {
    p_query: normalizedQuery,
    p_limit: safeLimit,
  })

  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid city search response')

  return (data as CitySearchRow[]).map((row) => {
    if (
      typeof row.id !== 'string' ||
      typeof row.city_name !== 'string' ||
      typeof row.city_slug !== 'string' ||
      typeof row.state_code !== 'string' ||
      typeof row.state_name !== 'string'
    ) {
      throw new Error('Invalid city search response')
    }

    return {
      id: row.id,
      cityName: row.city_name,
      citySlug: row.city_slug,
      stateCode: row.state_code,
      stateName: row.state_name,
    }
  })
}
