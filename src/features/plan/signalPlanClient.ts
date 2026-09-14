import { supabase } from '../../lib/supabaseClient'

const PLAN_CONVERSION_TIMEOUT_MS = 12_000
const PLAN_CONVERSION_RETRY_DELAY_MS = 250
const PLAN_CONVERSION_MAX_ATTEMPTS = 2

export type SignalPlanConversionResult = {
  planId: string
  created: boolean
}

type ConversionRow = {
  plan_id: unknown
  created: unknown
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function convertSignalToPlan(
  signalGroupId: string,
): Promise<SignalPlanConversionResult> {
  let lastMessage = 'Unable to create the Signal Plan'

  for (let attempt = 0; attempt < PLAN_CONVERSION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PLAN_CONVERSION_TIMEOUT_MS)

    try {
      const { data, error, status } = await supabase
        .rpc('convert_locked_signal_group_to_plan', { p_signal_group_id: signalGroupId })
        .abortSignal(controller.signal)

      if (!error) {
        if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
          throw new Error('Signal Plan conversion returned an invalid response')
        }

        const row = data[0] as ConversionRow
        if (typeof row.plan_id !== 'string' || typeof row.created !== 'boolean') {
          throw new Error('Signal Plan conversion returned invalid fields')
        }

        return { planId: row.plan_id, created: row.created }
      }

      lastMessage = error.message || lastMessage
      const retryable = status === 0 || status >= 500
      if (!retryable || attempt + 1 >= PLAN_CONVERSION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await delay(PLAN_CONVERSION_RETRY_DELAY_MS)
  }

  throw new Error(lastMessage)
}

