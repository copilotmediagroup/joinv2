import { supabase } from '../../lib/supabaseClient'

const OUTING_MUTATION_MAX_ATTEMPTS = 2
const OUTING_MUTATION_RETRY_DELAY_MS = 250
const OUTING_MUTATION_TIMEOUT_MS = 12_000

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
  let lastMessage = 'Unable to end your live Signal.'

  for (let attempt = 0; attempt < OUTING_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), OUTING_MUTATION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('finish_my_plan_outing', { p_plan_id: planId })
        .abortSignal(controller.signal)

      if (!error) {
        if (data !== true) throw new Error('Signal completion returned an invalid response.')
        return
      }

      lastMessage = error.message || lastMessage
      if (!(status === 0 || status >= 500) || attempt + 1 >= OUTING_MUTATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, OUTING_MUTATION_RETRY_DELAY_MS))
  }

  throw new Error(lastMessage)
}
