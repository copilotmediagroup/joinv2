import { supabase } from '../../lib/supabaseClient'

const ATTENDANCE_MAX_ATTEMPTS = 2

export type PlanAttendanceStatus = {
  planId: string
  planState: string
  serverNow: string
  windowOpensAt: string | null
  windowClosesAt: string | null
  canCheckIn: boolean
  checkedIn: boolean
  checkedInAt: string | null
  verified: boolean
  checkedInCount: number
  activeMemberCount: number
}

type AttendancePayload = Record<string, unknown>

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid attendance response: ${field}`)
  }
  return value
}
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid attendance response: ${field}`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid attendance response: ${field}`)
  }
  return value
}

function parseStatus(value: unknown): PlanAttendanceStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid attendance response')
  }

  const row = value as AttendancePayload
  return {
    planId: requireString(row.planId, 'planId'),
    planState: requireString(row.planState, 'planState'),
    serverNow: requireString(row.serverNow, 'serverNow'),
    windowOpensAt: optionalString(row.windowOpensAt),
    windowClosesAt: optionalString(row.windowClosesAt),
    canCheckIn: requireBoolean(row.canCheckIn, 'canCheckIn'),
    checkedIn: requireBoolean(row.checkedIn, 'checkedIn'),
    checkedInAt: optionalString(row.checkedInAt),
    verified: requireBoolean(row.verified, 'verified'),
    checkedInCount: requireNumber(row.checkedInCount, 'checkedInCount'),
    activeMemberCount: requireNumber(row.activeMemberCount, 'activeMemberCount'),
  }
}

export async function getMyPlanAttendanceStatus(
  planId: string,
): Promise<PlanAttendanceStatus> {
  const { data, error } = await supabase.rpc(
    'get_my_plan_attendance_status',
    { p_plan_id: planId },
  )

  if (error) {
    throw new Error(error.message || 'Unable to load check-in status')
  }

  return parseStatus(data)
}

export function subscribeToLivePlanRefresh(planId: string, onInvalidate: () => void): () => void {
  const channel = supabase
    .channel(`plan-live:${planId}`)
    .on('broadcast', { event: 'refresh' }, onInvalidate)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function checkInToMyPlan(
  planId: string,
): Promise<PlanAttendanceStatus> {
  let lastError: unknown = null

  for (let attempt = 0; attempt < ATTENDANCE_MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.rpc(
      'check_in_to_my_plan',
      { p_plan_id: planId },
    )

    if (!error) return parseStatus(data)

    lastError = error
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status ?? 0)
      : 0
    if (!(status === 0 || status >= 500) || attempt + 1 >= ATTENDANCE_MAX_ATTEMPTS) break
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }

  const message = typeof lastError === 'object' && lastError !== null && 'message' in lastError
    ? String((lastError as { message?: unknown }).message ?? '')
    : ''
  throw new Error(message || 'Unable to check in')
}
