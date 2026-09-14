import { supabase } from '../../../lib/supabaseClient'

const SIGNAL_CONFIRMATION_TIMEOUT_MS = 12_000
const SIGNAL_CONFIRMATION_RETRY_DELAY_MS = 250
const SIGNAL_CONFIRMATION_MAX_ATTEMPTS = 2

export type SignalConfirmationGroupState =
  | 'forming'
  | 'confirming'
  | 'coordinating'

export type SignalConfirmationMembershipState =
  | 'matched'
  | 'confirmed'
  | 'declined'
  | 'timed_out'
  | 'withdrawn'
  | 'replaced'

export type SignalConfirmationResult = {
  signalIntentId: string
  signalGroupId: string
  groupState: SignalConfirmationGroupState
  membershipId: string
  membershipState: SignalConfirmationMembershipState
  isActiveCore: boolean
  confirmedAt: string | null
  matchedMemberCount: number
  confirmedActiveCoreCount: number
  activationThreshold: number
  confirmationDeadline: string | null
  coordinationDeadline: string | null
}

type SignalConfirmationRow = {
  signal_intent_id: unknown
  signal_group_id: unknown
  group_state: unknown
  membership_id: unknown
  membership_state: unknown
  is_active_core: unknown
  confirmed_at: unknown
  matched_member_count: unknown
  confirmed_active_core_count: unknown
  activation_threshold: unknown
  confirmation_deadline: unknown
  coordination_deadline: unknown
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
      `Signal confirmation returned invalid ${field}`,
    )
  }

  return value
}

function requireBoolean(
  value: unknown,
  field: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Signal confirmation returned invalid ${field}`,
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
      `Signal confirmation returned invalid ${field}`,
    )
  }

  return value
}

function requireNullableTimestamp(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(
      `Signal confirmation returned invalid ${field}`,
    )
  }

  return value
}

function requireGroupState(
  value: unknown,
): SignalConfirmationGroupState {
  if (
    value !== 'forming' &&
    value !== 'confirming' &&
    value !== 'coordinating'
  ) {
    throw new Error(
      'Signal confirmation returned invalid group state',
    )
  }

  return value
}

function requireMembershipState(
  value: unknown,
): SignalConfirmationMembershipState {
  if (
    value !== 'matched' &&
    value !== 'confirmed' &&
    value !== 'declined' &&
    value !== 'timed_out' &&
    value !== 'withdrawn' &&
    value !== 'replaced'
  ) {
    throw new Error(
      'Signal confirmation returned invalid membership state',
    )
  }

  return value
}

export async function confirmMySignalMembership(
  signalIntentId: string,
): Promise<SignalConfirmationResult> {
  if (
    typeof signalIntentId !== 'string' ||
    signalIntentId.trim().length === 0
  ) {
    throw new Error(
      'A Signal intent is required to confirm a Signal',
    )
  }

  let data: unknown = null
  let succeeded = false
  let lastMessage = 'Unable to confirm this Signal'

  for (let attempt = 0; attempt < SIGNAL_CONFIRMATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), SIGNAL_CONFIRMATION_TIMEOUT_MS)

    try {
      const result = await supabase
        .rpc('confirm_my_signal_membership', { p_signal_intent_id: signalIntentId })
        .abortSignal(controller.signal)

      if (!result.error) {
        data = result.data
        succeeded = true
        break
      }

      lastMessage = result.error.message || lastMessage
      const retryable = result.status === 0 || result.status >= 500
      if (!retryable || attempt + 1 >= SIGNAL_CONFIRMATION_MAX_ATTEMPTS) break
    } finally {
      window.clearTimeout(timeoutId)
    }

    await new Promise((resolve) => window.setTimeout(resolve, SIGNAL_CONFIRMATION_RETRY_DELAY_MS))
  }

  if (!succeeded) throw new Error(lastMessage)

  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    data[0] === null ||
    typeof data[0] !== 'object'
  ) {
    throw new Error(
      'Signal confirmation returned an invalid response',
    )
  }

  const row =
    data[0] as SignalConfirmationRow

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
    membershipId: requireString(
      row.membership_id,
      'membership id',
    ),
    membershipState: requireMembershipState(
      row.membership_state,
    ),
    isActiveCore: requireBoolean(
      row.is_active_core,
      'active core state',
    ),
    confirmedAt: requireNullableTimestamp(
      row.confirmed_at,
      'confirmed timestamp',
    ),
    matchedMemberCount: requireInteger(
      row.matched_member_count,
      'matched member count',
    ),
    confirmedActiveCoreCount: requireInteger(
      row.confirmed_active_core_count,
      'confirmed active core count',
    ),
    activationThreshold: requireInteger(
      row.activation_threshold,
      'activation threshold',
    ),
    confirmationDeadline: requireNullableTimestamp(
      row.confirmation_deadline,
      'confirmation deadline',
    ),
    coordinationDeadline: requireNullableTimestamp(
      row.coordination_deadline,
      'coordination deadline',
    ),
  }
}
