import { supabase } from '../../../lib/supabaseClient'
import type { SignalPlace, SignalPlaceReview } from '../places/contract'

export type SignalResumeState =
  | 'forming'
  | 'confirming'
  | 'coordinating'
  | 'locked'
  | 'active_outing'

export type SignalResumeCrowdMode =
  | 'everyone'
  | 'women_only'
  | 'men_only'

export type SignalResumeStage = 'arrival' | 'places' | 'time' | 'plan'

export type SignalResumeVenue = {
  placeId: string
  name: string
  address: string
  photoUrl: string | null
  reviews: SignalPlaceReview[]
  openingHours: SignalPlace['openingHours']
  utcOffsetMinutes: number | null
  openNow: boolean | null
}

export type SignalResumeResult = {
  signalIntentId: string | null
  signalGroupId: string
  groupState: SignalResumeState
  memberCount: number
  activationThreshold: number
  activitySlug: string
  timeWindowCode: 'NOW' | 'TONIGHT' | 'TOMORROW' | 'THIS_WEEKEND' | null
  crowdMode: SignalResumeCrowdMode
  minAge: number | null
  maxAge: number | null
  signalStage: SignalResumeStage
  lockedVenue: SignalResumeVenue | null
  planId: string | null
  planDetailsOpened: boolean
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
  signal_stage: unknown
  locked_venue: unknown
  plan_id: unknown
  plan_details_opened: unknown
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

function parseVenue(value: unknown): SignalResumeVenue | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Signal resume response: locked_venue')
  }

  const venue = value as Record<string, unknown>
  const openNow = venue.openNow
  const utcOffsetMinutes = venue.utcOffsetMinutes

  return {
    placeId: requireString(venue.placeId, 'locked_venue.placeId'),
    name: requireString(venue.name, 'locked_venue.name'),
    address: typeof venue.address === 'string' ? venue.address : '',
    photoUrl: typeof venue.photoUrl === 'string' ? venue.photoUrl : null,
    reviews: Array.isArray(venue.reviews)
      ? venue.reviews as SignalPlaceReview[]
      : [],
    openingHours:
      venue.openingHours && typeof venue.openingHours === 'object'
        ? venue.openingHours as SignalPlace['openingHours']
        : null,
    utcOffsetMinutes:
      typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes)
        ? utcOffsetMinutes
        : null,
    openNow: typeof openNow === 'boolean' ? openNow : null,
  }
}
function parseResumeRow(row: ResumeRpcRow): SignalResumeResult {
  const groupState = requireString(row.group_state, 'group_state')
  if (!['forming', 'confirming', 'coordinating', 'locked', 'active_outing'].includes(groupState)) {
    throw new Error('Invalid Signal resume response: group_state')
  }

  const crowdMode = requireString(row.crowd_mode, 'crowd_mode')
  if (!['everyone', 'women_only', 'men_only'].includes(crowdMode)) {
    throw new Error('Invalid Signal resume response: crowd_mode')
  }

  const signalStage = requireString(row.signal_stage, 'signal_stage')
  if (!['arrival', 'places', 'time', 'plan'].includes(signalStage)) {
    throw new Error('Invalid Signal resume response: signal_stage')
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
    signalIntentId: typeof row.signal_intent_id === 'string' ? row.signal_intent_id : null,
    signalGroupId: requireString(row.signal_group_id, 'signal_group_id'),
    groupState: groupState as SignalResumeState,
    memberCount: requireNumber(row.member_count, 'member_count'),
    activationThreshold: requireNumber(row.activation_threshold, 'activation_threshold'),
    activitySlug: requireString(row.activity_slug, 'activity_slug'),
    timeWindowCode,
    crowdMode: crowdMode as SignalResumeCrowdMode,
    minAge: nullableNumber(row.min_age, 'min_age'),
    maxAge: nullableNumber(row.max_age, 'max_age'),
    signalStage: signalStage as SignalResumeStage,
    lockedVenue: parseVenue(row.locked_venue),
    planId: typeof row.plan_id === 'string' ? row.plan_id : null,
    planDetailsOpened: row.plan_details_opened === true,
  }
}

export async function getMyActiveSignalResume(): Promise<SignalResumeResult | null> {
  const { data, error } = await supabase.rpc('get_my_active_signal_journey_resume')

  if (error) {
    throw new Error(error.message || 'Unable to restore your active Signal.')
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid Signal resume response.')
  }

  if (data.length === 0) return null

  return parseResumeRow(data[0] as ResumeRpcRow)
}

export async function openMySignalPlanDetails(planId: string): Promise<void> {
  const { error } = await supabase.rpc('open_my_signal_plan_details', { p_plan_id: planId })
  if (error) throw new Error(error.message || 'Unable to open live Signal details.')
}
