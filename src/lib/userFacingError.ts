const INTERNAL_ERROR_PATTERNS = [
  /plan_membership_required/i,
  /active_plan_membership_not_found/i,
  /live_signal_assignment_not_found/i,
  /live_signal_membership_not_found/i,
  /signal_group_not_found/i,
  /signal_stage_mismatch/i,
  /authentication_required/i,
  /permission denied/i,
  /row-level security/i,
  /violates .*constraint/i,
  /duplicate key/i,
  /null value in column/i,
  /edge function returned/i,
  /invalid .*response/i,
  /\bP0001\b/i,
  /\b42501\b/i,
  /JWT/i,
]

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}
export function toUserFacingError(
  error: unknown,
  fallback: string,
): string {
  const message = extractMessage(error)
  if (!message) return fallback

  if (/network|failed to fetch|load failed|offline/i.test(message)) {
    return 'Connection lost. Check your internet and try again.'
  }

  if (INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback
  }

  return message.length <= 180 ? message : fallback
}
