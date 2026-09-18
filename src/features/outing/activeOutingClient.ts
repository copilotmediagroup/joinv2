import { supabase } from '../../lib/supabaseClient'

export type ActiveSignalOuting = {
  planId: string
  planState: 'locked' | 'recovery_required' | 'active_outing'
  scheduledStartsAt: string | null
  scheduledEndsAt: string | null
  checkedInAt: string
}

type ActiveOutingRow = {
  plan_id: unknown
  plan_state: unknown
  scheduled_starts_at: unknown
  scheduled_ends_at: unknown
  checked_in_at: unknown
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export async function getMyActiveSignalOuting(): Promise<ActiveSignalOuting | null> {
  const { data, error } = await supabase.rpc('get_my_active_signal_outing')
  if (error) throw new Error(error.message || 'Unable to restore your live outing.')
  if (!Array.isArray(data) || data.length === 0) return null

  const row = data[0] as ActiveOutingRow
  const planId = nullableString(row.plan_id)
  const planState = nullableString(row.plan_state)
  const checkedInAt = nullableString(row.checked_in_at)
  if (!planId || !checkedInAt || !['locked', 'recovery_required', 'active_outing'].includes(planState ?? '')) {
    throw new Error('Invalid active outing response.')
  }

  return {
    planId,
    planState: planState as ActiveSignalOuting['planState'],
    scheduledStartsAt: nullableString(row.scheduled_starts_at),
    scheduledEndsAt: nullableString(row.scheduled_ends_at),
    checkedInAt,
  }
}

export async function finishMyPlanOuting(planId: string): Promise<void> {
  const { error } = await supabase.rpc('finish_my_plan_outing', { p_plan_id: planId })
  if (error) throw new Error(error.message || 'Unable to end your live Signal.')
}
