import { supabase } from '../../lib/supabaseClient'

export type OnboardingCityOption = {
  id: string
  cityName: string
  citySlug: string
  stateCode: string
  stateName: string
}

type CityRow = {
  id: string
  name: string
  slug: string
  state_id: string
  states:
    | {
        code: string
        name: string
      }
    | {
        code: string
        name: string
      }[]
    | null
}

function normalizeState(
  value: CityRow['states'],
): { code: string; name: string } | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
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

  const { data, error } = await supabase
    .from('cities')
    .select(`
      id,
      name,
      slug,
      state_id,
      states!inner (
        code,
        name
      )
    `)
    .eq('is_active', true)
    .eq('states.is_active', true)
    .ilike('name', `${normalizedQuery}%`)
    .order('name', { ascending: true })
    .limit(safeLimit)

  if (error) {
    throw error
  }

  return ((data ?? []) as unknown as CityRow[])
    .map((row) => {
      const state = normalizeState(row.states)

      if (!state) {
        return null
      }

      return {
        id: row.id,
        cityName: row.name,
        citySlug: row.slug,
        stateCode: state.code,
        stateName: state.name,
      }
    })
    .filter((row): row is OnboardingCityOption => row !== null)
}
