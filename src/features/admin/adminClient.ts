import { supabase } from '../../lib/supabaseClient'

export type ModerationReportState =
  | 'open' | 'reviewing' | 'resolved' | 'dismissed'

export type ModerationAssignmentScope = 'all' | 'mine' | 'unassigned'

export type ModerationReport = {
  reportId: string
  reporterUserId: string
  reporterDisplayName: string
  reportedUserId: string
  reportedDisplayName: string
  reason: string
  details: string | null
  state: ModerationReportState
  assignedAdminUserId: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ModerationCursor = {
  createdAt: string
  reportId: string
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid admin response: ${field}`)
  }
  return value
}
export async function getMyAdminCapabilities(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_my_admin_capabilities')
  if (error) throw new Error(error.message || 'Unable to load admin access')
  if (!Array.isArray(data)) return []

  return data
    .map((raw) => (raw as Record<string, unknown>).capability)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

export async function getModerationReportQueue(input: {
  state: ModerationReportState | null
  assignment: ModerationAssignmentScope
  cursor?: ModerationCursor | null
  limit?: number
}): Promise<ModerationReport[]> {
  const { data, error } = await supabase.rpc('get_moderation_report_queue', {
    p_state: input.state,
    p_assignment: input.assignment,
    p_after_created_at: input.cursor?.createdAt ?? null,
    p_after_id: input.cursor?.reportId ?? null,
    p_limit: input.limit ?? 40,
  })
  if (error) throw new Error(error.message || 'Unable to load moderation queue')
  if (!Array.isArray(data)) throw new Error('Invalid moderation queue response')

  return data.map((raw) => mapModerationReport(raw as Record<string, unknown>))
}
function mapModerationReport(row: Record<string, unknown>): ModerationReport {
  const state = required(row.state, 'state') as ModerationReportState
  return {
    reportId: required(row.report_id, 'report id'),
    reporterUserId: required(row.reporter_user_id, 'reporter user id'),
    reporterDisplayName: required(row.reporter_display_name, 'reporter display name'),
    reportedUserId: required(row.reported_user_id, 'reported user id'),
    reportedDisplayName: required(row.reported_display_name, 'reported display name'),
    reason: required(row.reason, 'reason'),
    details: typeof row.details === 'string' ? row.details : null,
    state,
    assignedAdminUserId:
      typeof row.assigned_admin_user_id === 'string' ? row.assigned_admin_user_id : null,
    claimedAt: typeof row.claimed_at === 'string' ? row.claimed_at : null,
    createdAt: required(row.created_at, 'created at'),
    updatedAt: required(row.updated_at, 'updated at'),
  }
}

export async function claimNextModerationReport(): Promise<string | null> {
  const { data, error } = await supabase.rpc('claim_next_moderation_report')
  if (error) throw new Error(error.message || 'Unable to claim next report')
  if (data === null) return null
  return required(data, 'claimed report id')
}
export async function releaseMyModerationReport(reportId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('release_my_moderation_report', {
    p_report_id: reportId,
  })
  if (error) throw new Error(error.message || 'Unable to release this report')
  return data === true
}

export async function reviewUserReport(input: {
  reportId: string
  state: 'resolved' | 'dismissed'
  note: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('review_user_report', {
    p_report_id: input.reportId,
    p_state: input.state,
    p_note: input.note,
  })
  if (error) throw new Error(error.message || 'Unable to review this report')
}
