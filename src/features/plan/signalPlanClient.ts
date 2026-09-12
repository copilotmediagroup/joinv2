import { supabase } from '../../lib/supabaseClient'

export type SignalPlanConversionResult = {
  planId: string
  created: boolean
}

type ConversionRow = {
  plan_id: unknown
  created: unknown
}

export async function convertSignalToPlan(
  signalGroupId: string,
): Promise<SignalPlanConversionResult> {
  const { data, error } = await supabase.rpc(
    'convert_locked_signal_group_to_plan',
    { p_signal_group_id: signalGroupId },
  )

  if (error) {
    throw new Error(error.message || 'Unable to create the Signal Plan')
  }

  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    !data[0] ||
    typeof data[0] !== 'object'
  ) {
    throw new Error('Signal Plan conversion returned an invalid response')
  }

  const row = data[0] as ConversionRow

  if (
    typeof row.plan_id !== 'string' ||
    typeof row.created !== 'boolean'
  ) {
    throw new Error('Signal Plan conversion returned invalid fields')
  }

  return {
    planId: row.plan_id,
    created: row.created,
  }
}
