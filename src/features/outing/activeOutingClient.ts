import { supabase } from '../../lib/supabaseClient'

const OUTING_MUTATION_MAX_ATTEMPTS = 2
const OUTING_MUTATION_RETRY_DELAY_MS = 250
const OUTING_MUTATION_TIMEOUT_MS = 12_000

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
