import { supabase } from '../../lib/supabaseClient'

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

export async function checkInToMyPlan(
  planId: string,
): Promise<PlanAttendanceStatus> {
  const { data, error } = await supabase.rpc(
    'check_in_to_my_plan',
    { p_plan_id: planId },
  )

  if (error) {
    throw new Error(error.message || 'Unable to check in')
  }

  return parseStatus(data)
}
