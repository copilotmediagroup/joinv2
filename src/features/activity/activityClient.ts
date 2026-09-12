import { supabase } from '../../lib/supabaseClient'

export type ActivityItemType =
  | 'signal'
  | 'plan'

export type ActivityItem = {
  itemType: ActivityItemType
  itemId: string

  signalGroupId: string | null
  signalIntentId: string | null
  planId: string | null

  activityId: string
  activitySlug: string
  activityName: string

  lifecycleState: string
  membershipState: string

  isActiveCore: boolean

  startsAt: string | null
  endsAt: string | null
  expiresAt: string | null

  scheduledStartsAt: string | null
  scheduledEndsAt: string | null

  joinedAt: string | null
  updatedAt: string
}

type ActivityRpcRow = {
  item_type: unknown
  item_id: unknown

  signal_group_id: unknown
  signal_intent_id: unknown
  plan_id: unknown

  activity_id: unknown
  activity_slug: unknown
  activity_name: unknown

  lifecycle_state: unknown
  membership_state: unknown

  is_active_core: unknown

  starts_at: unknown
  ends_at: unknown
  expires_at: unknown

  scheduled_starts_at: unknown
  scheduled_ends_at: unknown

  joined_at: unknown
  updated_at: unknown
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
      `Invalid Activity response: ${field}`,
    )
  }

  return value
}

function nullableString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) {
    return null
  }

  return requireString(value, field)
}

function requireBoolean(
  value: unknown,
  field: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `Invalid Activity response: ${field}`,
    )
  }

  return value
}

function parseItemType(
  value: unknown,
): ActivityItemType {
  if (
    value !== 'signal' &&
    value !== 'plan'
  ) {
    throw new Error(
      'Invalid Activity response: item_type',
    )
  }

  return value
}

function parseActivityRow(
  row: ActivityRpcRow,
): ActivityItem {
  const itemType =
    parseItemType(row.item_type)

  const signalGroupId =
    nullableString(
      row.signal_group_id,
      'signal_group_id',
    )

  const signalIntentId =
    nullableString(
      row.signal_intent_id,
      'signal_intent_id',
    )

  const planId =
    nullableString(
      row.plan_id,
      'plan_id',
    )

  if (itemType === 'signal') {
    if (
      !signalGroupId ||
      !signalIntentId ||
      planId
    ) {
      throw new Error(
        'Invalid Activity response: malformed signal item',
      )
    }
  }

  if (itemType === 'plan') {
    if (
      !planId ||
      signalGroupId ||
      signalIntentId
    ) {
      throw new Error(
        'Invalid Activity response: malformed plan item',
      )
    }
  }

  return {
    itemType,
    itemId:
      requireString(
        row.item_id,
        'item_id',
      ),

    signalGroupId,
    signalIntentId,
    planId,

    activityId:
      requireString(
        row.activity_id,
        'activity_id',
      ),
    activitySlug:
      requireString(
        row.activity_slug,
        'activity_slug',
      ),
    activityName:
      requireString(
        row.activity_name,
        'activity_name',
      ),

    lifecycleState:
      requireString(
        row.lifecycle_state,
        'lifecycle_state',
      ),
    membershipState:
      requireString(
        row.membership_state,
        'membership_state',
      ),

    isActiveCore:
      requireBoolean(
        row.is_active_core,
        'is_active_core',
      ),

    startsAt:
      nullableString(
        row.starts_at,
        'starts_at',
      ),
    endsAt:
      nullableString(
        row.ends_at,
        'ends_at',
      ),
    expiresAt:
      nullableString(
        row.expires_at,
        'expires_at',
      ),

    scheduledStartsAt:
      nullableString(
        row.scheduled_starts_at,
        'scheduled_starts_at',
      ),
    scheduledEndsAt:
      nullableString(
        row.scheduled_ends_at,
        'scheduled_ends_at',
      ),

    joinedAt:
      nullableString(
        row.joined_at,
        'joined_at',
      ),
    updatedAt:
      requireString(
        row.updated_at,
        'updated_at',
      ),
  }
}

export async function getMyActivity():
Promise<ActivityItem[]> {
  const {
    data,
    error,
  } = await supabase.rpc(
    'get_my_activity',
  )

  if (error) {
    throw new Error(
      error.message ||
        'Unable to load Activity.',
    )
  }

  if (!Array.isArray(data)) {
    throw new Error(
      'Invalid Activity response.',
    )
  }

  return data.map((row) =>
    parseActivityRow(
      row as ActivityRpcRow,
    ),
  )
}
