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

export type AccountEnforcementSummary = {
  restriction: 'suspended' | 'banned' | null
  restrictedUntil: string | null
  latestAction: 'warning' | 'suspension' | 'ban' | 'lift' | null
  latestReason: string | null
  latestActionAt: string | null
}

export async function getUserAccountEnforcementSummary(
  userId: string,
): Promise<AccountEnforcementSummary> {
  const { data, error } = await supabase.rpc('get_user_account_enforcement_summary', {
    p_target_user_id: userId,
  })
  if (error) throw new Error(error.message || 'Unable to load account enforcement')
  const row = Array.isArray(data) && data[0] ? data[0] as Record<string, unknown> : {}
  const restriction = row.restriction === 'suspended' || row.restriction === 'banned'
    ? row.restriction : null
  const action = ['warning', 'suspension', 'ban', 'lift'].includes(String(row.latest_action))
    ? row.latest_action as AccountEnforcementSummary['latestAction'] : null
  return { restriction, restrictedUntil: typeof row.restricted_until === 'string' ? row.restricted_until : null,
    latestAction: action, latestReason: typeof row.latest_reason === 'string' ? row.latest_reason : null,
    latestActionAt: typeof row.latest_action_at === 'string' ? row.latest_action_at : null }
}

export async function enforceUserAccount(input: {
  userId: string
  action: 'warning' | 'suspension' | 'ban'
  durationMinutes?: number | null
  reason: string
  sourceReportId?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('enforce_user_account', {
    p_target_user_id: input.userId,
    p_action: input.action,
    p_duration_minutes: input.durationMinutes ?? null,
    p_reason: input.reason,
    p_source_report_id: input.sourceReportId ?? null,
  })
  if (error) throw new Error(error.message || 'Unable to enforce account action')
}

export async function liftUserAccountRestriction(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('lift_user_account_restriction', {
    p_target_user_id: userId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message || 'Unable to lift account restriction')
}

export type ModerationMomentState = 'open' | 'reviewed' | 'dismissed' | 'actioned'
export type ModerationMomentReport = {
  reportId: string
  momentId: string
  reporterUserId: string
  reporterDisplayName: string
  authorUserId: string
  authorDisplayName: string
  caption: string | null
  reason: string
  details: string | null
  state: ModerationMomentState
  assignedAdminUserId: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

function mapModerationMomentReport(row: Record<string, unknown>): ModerationMomentReport {
  return {
    reportId: required(row.report_id, 'moment report id'), momentId: required(row.moment_id, 'moment id'),
    reporterUserId: required(row.reporter_user_id, 'reporter user id'), reporterDisplayName: required(row.reporter_display_name, 'reporter display name'),
    authorUserId: required(row.author_user_id, 'author user id'), authorDisplayName: required(row.author_display_name, 'author display name'),
    caption: typeof row.caption === 'string' ? row.caption : null, reason: required(row.reason, 'reason'), details: typeof row.details === 'string' ? row.details : null,
    state: required(row.state, 'state') as ModerationMomentState, assignedAdminUserId: typeof row.assigned_admin_user_id === 'string' ? row.assigned_admin_user_id : null,
    claimedAt: typeof row.claimed_at === 'string' ? row.claimed_at : null, createdAt: required(row.created_at, 'created at'), updatedAt: required(row.updated_at, 'updated at'),
  }
}

export async function getModerationMomentQueue(input: {
  state: ModerationMomentState | null
  assignment: ModerationAssignmentScope
  cursor?: ModerationCursor | null
  limit?: number
}): Promise<ModerationMomentReport[]> {
  const { data, error } = await supabase.rpc('get_moderation_moment_queue', {
    p_state: input.state, p_assignment: input.assignment,
    p_after_created_at: input.cursor?.createdAt ?? null, p_after_id: input.cursor?.reportId ?? null,
    p_limit: input.limit ?? 40,
  })
  if (error) throw new Error(error.message || 'Unable to load Moment moderation queue')
  if (!Array.isArray(data)) throw new Error('Invalid Moment moderation queue response')
  return data.map((raw) => mapModerationMomentReport(raw as Record<string, unknown>))
}

export async function claimNextModerationMoment(): Promise<string | null> {
  const { data, error } = await supabase.rpc('claim_next_moderation_moment')
  if (error) throw new Error(error.message || 'Unable to claim next Moment report')
  return data === null ? null : required(data, 'claimed Moment report id')
}

export async function releaseMyModerationMoment(reportId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('release_my_moderation_moment', { p_report_id: reportId })
  if (error) throw new Error(error.message || 'Unable to release Moment report')
  return data === true
}

export async function reviewModerationMoment(input: {
  reportId: string
  state: 'dismissed' | 'actioned'
  note: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('review_moderation_moment', {
    p_report_id: input.reportId,
    p_state: input.state,
    p_note: input.note,
  })
  if (error) throw new Error(error.message || 'Unable to finish Moment report')
}

export type ModerationMomentEvidenceMedia = {
  storagePath: string
  mediaKind: 'image' | 'video'
  mimeType: string
  url: string
}

export async function getModerationMomentEvidence(
  reportId: string,
): Promise<ModerationMomentEvidenceMedia[]> {
  const { data, error } = await supabase.rpc('get_moderation_moment_evidence', {
    p_report_id: reportId,
  })
  if (error) throw new Error(error.message || 'Unable to load Moment evidence')
  const row = Array.isArray(data) && data[0] ? data[0] as Record<string, unknown> : null
  if (!row || !Array.isArray(row.media)) return []

  return Promise.all(row.media.map(async (raw) => {
    const media = raw as Record<string, unknown>
    const storagePath = required(media.storagePath, 'evidence storage path')
    const mediaKind = required(media.mediaKind, 'evidence media kind')
    const mimeType = required(media.mimeType, 'evidence mime type')
    if (mediaKind !== 'image' && mediaKind !== 'video') {
      throw new Error('Invalid Moment evidence media kind')
    }
    const { data: signed, error: signedError } = await supabase.storage
      .from('signal-moments')
      .createSignedUrl(storagePath, 60 * 15)
    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message || 'Unable to sign Moment evidence')
    }
    return {
      storagePath,
      mediaKind,
      mimeType,
      url: signed.signedUrl,
    } as ModerationMomentEvidenceMedia
  }))
}
