import { supabase } from '../../lib/supabaseClient'

const ONBOARDING_MUTATION_TIMEOUT_MS = 12_000
const ONBOARDING_MUTATION_RETRY_DELAY_MS = 250
const ONBOARDING_MUTATION_MAX_ATTEMPTS = 2

export type ProfileGender = 'male' | 'female'

export type ProfileCompletionState = 'incomplete' | 'complete'

export type OnboardingState = {
  userId: string
  displayName: string | null
  avatarPath: string | null
  birthDate: string | null
  gender: ProfileGender | null
  homeCityId: string | null
  cityName: string | null
  citySlug: string | null
  stateCode: string | null
  stateName: string | null
  completionState: ProfileCompletionState
}

type OnboardingRpcRow = {
  user_id: string
  display_name: string | null
  avatar_path: string | null
  birth_date: string | null
  gender: ProfileGender | null
  home_city_id: string | null
  city_name: string | null
  city_slug: string | null
  state_code: string | null
  state_name: string | null
  completion_state: ProfileCompletionState
}

export type CompleteOnboardingInput = {
  displayName: string
  avatarPath: string
  birthDate: string
  gender: ProfileGender
  homeCityId: string
}

function mapOnboardingRow(row: OnboardingRpcRow): OnboardingState {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    birthDate: row.birth_date,
    gender: row.gender,
    homeCityId: row.home_city_id,
    cityName: row.city_name,
    citySlug: row.city_slug,
    stateCode: row.state_code,
    stateName: row.state_name,
    completionState: row.completion_state,
  }
}

function requireSingleRow(
  value: OnboardingRpcRow | OnboardingRpcRow[] | null,
  operation: string,
): OnboardingRpcRow {
  const row = Array.isArray(value) ? value[0] : value

  if (!row) {
    throw new Error(`${operation} returned no profile.`)
  }

  return row
}

export async function getMyOnboardingState(): Promise<OnboardingState> {
  const { data, error } = await supabase.rpc('get_my_onboarding_state')

  if (error) {
    throw error
  }

  return mapOnboardingRow(
    requireSingleRow(
      data as OnboardingRpcRow | OnboardingRpcRow[] | null,
      'Onboarding state',
    ),
  )
}

export async function completeMyOnboarding(
  input: CompleteOnboardingInput,
): Promise<OnboardingState> {
  const displayName = input.displayName.trim()
  const avatarPath = input.avatarPath.trim()

  if (!displayName) {
    throw new Error('Display name is required.')
  }

  if (!avatarPath) {
    throw new Error('Avatar is required.')
  }

  if (!input.birthDate) {
    throw new Error('Birth date is required.')
  }

  if (!input.homeCityId) {
    throw new Error('Home city is required.')
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt < ONBOARDING_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), ONBOARDING_MUTATION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('complete_my_onboarding', {
          p_display_name: displayName,
          p_avatar_path: avatarPath,
          p_birth_date: input.birthDate,
          p_gender: input.gender,
          p_home_city_id: input.homeCityId,
        })
        .abortSignal(controller.signal)

      if (!error) {
        return mapOnboardingRow(
          requireSingleRow(
            data as OnboardingRpcRow | OnboardingRpcRow[] | null,
            'Complete onboarding',
          ),
        )
      }

      lastError = error
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= ONBOARDING_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, ONBOARDING_MUTATION_RETRY_DELAY_MS))
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to complete onboarding.')
}
