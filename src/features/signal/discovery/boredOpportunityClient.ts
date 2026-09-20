import { supabase } from '../../../lib/supabaseClient'

export type BoredOpportunity = {
  boredIntentId: string
  activityId: string
  activitySlug: string
  activityName: string
  activeCount: number
  timeWindow: 'NOW'
  reasonCode: string
}

type BoredOpportunityRow = {
  bored_intent_id: string
  activity_id: string
  activity_slug: string
  activity_name: string
  active_count: number
  time_window: string
  reason_code: string
}

export async function getMyBoredOpportunity(
  excludedActivitySlugs: string[] = [],
): Promise<BoredOpportunity | null> {  const { data, error } = await supabase.rpc(
    'get_my_bored_opportunity',
    { p_excluded_activity_slugs: excludedActivitySlugs },
  )
  if (error) throw error

  const row = Array.isArray(data)
    ? data[0] as BoredOpportunityRow | undefined
    : undefined
  if (!row) return null

  return {
    boredIntentId: row.bored_intent_id,
    activityId: row.activity_id,
    activitySlug: row.activity_slug,
    activityName: row.activity_name,
    activeCount: row.active_count,
    timeWindow: 'NOW',
    reasonCode: row.reason_code,
  }
}

export async function acceptMyBoredOpportunity(
  boredIntentId: string,
  activitySlug: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    'accept_my_bored_opportunity',
    {
      p_bored_intent_id: boredIntentId,
      p_activity_slug: activitySlug,
    },
  )
  if (error) throw error
}
