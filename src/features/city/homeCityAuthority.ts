import { supabase } from '../../lib/supabaseClient'

export type AuthoritativeHomeCity = {
  id: string
  name: string
  slug: string
  stateId: string
  stateCode: string
  stateName: string
  timezoneName: string | null
}

type AuthoritativeHomeCityRpcRow = {
  id: string
  name: string
  slug: string
  state_id: string
  state_code: string
  state_name: string
  timezone_name: string | null
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Home city authority missing ${field}`,
    )
  }

  return value
}

/**
 * Resolve the signed-in user's authoritative home city.
 *
 * Authority chain:
 *
 * browser session
 *   -> public.get_my_authoritative_home_city()
 *   -> auth.uid()
 *   -> public.user_profiles.home_city_id
 *   -> public.cities
 *   -> public.states
 *
 * There is intentionally:
 * - no Tampa fallback
 * - no guessed city
 * - no localStorage city authority
 * - no caller-supplied user id
 * - no caller-supplied city id
 * - no caller-supplied city slug
 * - no direct browser SELECT against user_profiles
 *
 * PostgreSQL remains authoritative.
 */
export async function getAuthoritativeHomeCity():
Promise<AuthoritativeHomeCity> {
  const {
    data: {
      user,
    },
    error: userError,
  } =
    await supabase.auth.getUser()

  if (userError) {
    throw new Error(
      'Unable to verify your signed-in account',
    )
  }

  if (!user) {
    throw new Error(
      'You must be signed in to use Signal',
    )
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      'get_my_authoritative_home_city',
    )

  if (error) {
    throw new Error(
      'Unable to resolve your authoritative home city',
    )
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(
      'Authoritative home city response is invalid',
    )
  }

  const row =
    data[0] as AuthoritativeHomeCityRpcRow

  return {
    id:
      requireNonEmptyString(
        row.id,
        'id',
      ),
    name:
      requireNonEmptyString(
        row.name,
        'name',
      ),
    slug:
      requireNonEmptyString(
        row.slug,
        'slug',
      ),
    stateId:
      requireNonEmptyString(
        row.state_id,
        'state_id',
      ),
    stateCode:
      requireNonEmptyString(
        row.state_code,
        'state_code',
      ),
    stateName:
      requireNonEmptyString(
        row.state_name,
        'state_name',
      ),
    timezoneName:
      row.timezone_name === null
        ? null
        : requireNonEmptyString(
            row.timezone_name,
            'timezone_name',
          ),
  }
}
