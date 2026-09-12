import { supabase } from '../../../lib/supabaseClient'

export type SignalResumeState =
  | 'forming'
  | 'confirming'
  | 'coordinating'
  | 'locked'

export type SignalResumeCrowdMode =
  | 'everyone'
  | 'women_only'
  | 'men_only'

export type SignalResumeResult = {
  signalIntentId: string
  signalGroupId: string
  groupState: SignalResumeState
  memberCount: number
  activationThreshold: number
  activitySlug: string
  timeWindowCode: 'NOW' | 'TONIGHT' | 'TOMORROW' | 'THIS_WEEKEND' | null
  crowdMode: SignalResumeCrowdMode
  minAge: number | null
  maxAge: number | null
}

type ResumeRpcRow = {
  signal_intent_id: unknown
  signal_group_id: unknown
  group_state: unknown
  member_count: unknown
  activation_threshold: unknown
  activity_slug: unknown
  time_window_code: unknown
  crowd_mode: unknown
  min_age: unknown
  max_age: unknown
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid Signal resume response: ${field}`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid Signal resume response: ${field}`)
  }
  return value
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null
  return requireNumber(value, field)
}

function parseResumeRow(row: ResumeRpcRow): SignalResumeResult {
  const groupState = requireString(row.group_state, 'group_state')
  if (!['forming', 'confirming', 'coordinating', 'locked'].includes(groupState)) {
    throw new Error('Invalid Signal resume response: group_state')
  }

  const crowdMode = requireString(row.crowd_mode, 'crowd_mode')
  if (!['everyone', 'women_only', 'men_only'].includes(crowdMode)) {
    throw new Error('Invalid Signal resume response: crowd_mode')
  }

  let timeWindowCode: SignalResumeResult['timeWindowCode'] = null
  if (row.time_window_code !== null) {
    const value = requireString(row.time_window_code, 'time_window_code')
    if (!['NOW', 'TONIGHT', 'TOMORROW', 'THIS_WEEKEND'].includes(value)) {
      throw new Error('Invalid Signal resume response: time_window_code')
    }
    timeWindowCode = value as SignalResumeResult['timeWindowCode']
  }

  return {
    signalIntentId: requireString(row.signal_intent_id, 'signal_intent_id'),
    signalGroupId: requireString(row.signal_group_id, 'signal_group_id'),
    groupState: groupState as SignalResumeState,
    memberCount: requireNumber(row.member_count, 'member_count'),
    activationThreshold: requireNumber(row.activation_threshold, 'activation_threshold'),
    activitySlug: requireString(row.activity_slug, 'activity_slug'),
    timeWindowCode,
    crowdMode: crowdMode as SignalResumeCrowdMode,
    minAge: nullableNumber(row.min_age, 'min_age'),
    maxAge: nullableNumber(row.max_age, 'max_age'),
  }
}

export async function getMyActiveSignalResume(): Promise<SignalResumeResult | null> {
  const { data, error } = await supabase.rpc('get_my_active_signal_resume')

  if (error) {
    throw new Error(error.message || 'Unable to restore your active Signal.')
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid Signal resume response.')
  }

  if (data.length === 0) return null

  return parseResumeRow(data[0] as ResumeRpcRow)
}
