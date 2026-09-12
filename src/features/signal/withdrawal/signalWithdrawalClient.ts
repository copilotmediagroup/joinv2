import { supabase } from '../../../lib/supabaseClient'

export type SignalWithdrawalResult = {
  signalIntentId: string
  signalGroupId: string
  groupState:
    | 'forming'
    | 'confirming'
    | 'coordinating'
    | 'locked'
  remainingMemberCount: number
  activationThreshold: number
}

type SignalWithdrawalRow = {
  signal_intent_id: unknown
  signal_group_id: unknown
  group_state: unknown
  remaining_member_count: unknown
  activation_threshold: unknown
}

function requireString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new Error(
      `Signal withdrawal returned invalid ${field}`,
    )
  }

  return value
}

function requireInteger(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `Signal withdrawal returned invalid ${field}`,
    )
  }

  return value
}

function requireGroupState(
  value: unknown,
): SignalWithdrawalResult['groupState'] {
  if (
    value !== 'forming' &&
    value !== 'confirming' &&
    value !== 'coordinating' &&
    value !== 'locked'
  ) {
    throw new Error(
      'Signal withdrawal returned invalid group state',
    )
  }

  return value
}

export async function withdrawMySignal(
  signalIntentId: string,
): Promise<SignalWithdrawalResult> {
  if (
    typeof signalIntentId !== 'string' ||
    signalIntentId.trim().length === 0
  ) {
    throw new Error(
      'A Signal intent is required to leave a Signal',
    )
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'withdraw_my_signal',
    {
      p_signal_intent_id: signalIntentId,
    },
  )

  if (error) {
    throw new Error(
      error.message ||
        'Unable to leave this Signal',
    )
  }

  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    data[0] === null ||
    typeof data[0] !== 'object'
  ) {
    throw new Error(
      'Signal withdrawal returned an invalid response',
    )
  }

  const row =
    data[0] as SignalWithdrawalRow

  return {
    signalIntentId: requireString(
      row.signal_intent_id,
      'signal intent id',
    ),
    signalGroupId: requireString(
      row.signal_group_id,
      'signal group id',
    ),
    groupState: requireGroupState(
      row.group_state,
    ),
    remainingMemberCount: requireInteger(
      row.remaining_member_count,
      'remaining member count',
    ),
    activationThreshold: requireInteger(
      row.activation_threshold,
      'activation threshold',
    ),
  }
}
