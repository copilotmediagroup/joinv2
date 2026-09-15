import type {
  RealtimeChannel,
  SupabaseClient,
} from '@supabase/supabase-js'

import { supabase } from '../../../lib/supabaseClient'

import type {
  SignalGroupMembershipSnapshot,
  SignalGroupSnapshot,
  SignalIntentSnapshot,
  SignalRealtimeConnectionState,
  SignalRealtimeListener,
  SignalRealtimeSubscription,
  SignalRealtimeTarget,
  SignalSnapshot,
} from './contract'

type SignalIntentRow = {
  id: string
  user_id: string
  city_id: string
  activity_id: string
  vibe_id: string | null
  starts_at: string
  ends_at: string
  expires_at: string
  crowd_mode: SignalIntentSnapshot['crowdMode']
  min_age: number | null
  max_age: number | null
  preferred_radius_miles: number | null
  journey_origin: SignalIntentSnapshot['journeyOrigin']
  state: SignalIntentSnapshot['state']
  created_at: string
  updated_at: string
}

type SignalGroupRow = {
  id: string
  city_id: string
  activity_id: string
  vibe_id: string | null
  grouping_policy_id: string
  starts_at: string
  ends_at: string
  expires_at: string
  crowd_mode: SignalGroupSnapshot['crowdMode']
  min_age: number | null
  max_age: number | null
  state: SignalGroupSnapshot['state']
  journey_stage: SignalGroupSnapshot['journeyStage']
  confirmation_deadline: string | null
  coordination_deadline: string | null
  formed_at: string | null
  locked_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

type SignalMembershipRow = {
  id: string
  signal_group_id: string
  user_id: string
  originating_signal_intent_id: string
  state: SignalGroupMembershipSnapshot['state']
  is_active_core: boolean
  matched_at: string
  confirmation_deadline: string | null
  confirmed_at: string | null
  ended_at: string | null
  replacement_reason: string | null
  created_at: string
  updated_at: string
}

function asError(
  value: unknown,
  fallback: string,
): Error {
  if (value instanceof Error) {
    return value
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  ) {
    return new Error(value.message)
  }

  return new Error(fallback)
}

function mapIntent(
  row: SignalIntentRow,
): SignalIntentSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    cityId: row.city_id,
    activityId: row.activity_id,
    vibeId: row.vibe_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    expiresAt: row.expires_at,
    crowdMode: row.crowd_mode,
    minAge: row.min_age,
    maxAge: row.max_age,
    preferredRadiusMiles:
      row.preferred_radius_miles,
    journeyOrigin: row.journey_origin,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapGroup(
  row: SignalGroupRow,
): SignalGroupSnapshot {
  return {
    id: row.id,
    cityId: row.city_id,
    activityId: row.activity_id,
    vibeId: row.vibe_id,
    groupingPolicyId: row.grouping_policy_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    expiresAt: row.expires_at,
    crowdMode: row.crowd_mode,
    minAge: row.min_age,
    maxAge: row.max_age,
    state: row.state,
    journeyStage: row.journey_stage,
    confirmationDeadline:
      row.confirmation_deadline,
    coordinationDeadline:
      row.coordination_deadline,
    formedAt: row.formed_at,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMembership(
  row: SignalMembershipRow,
): SignalGroupMembershipSnapshot {
  return {
    id: row.id,
    signalGroupId: row.signal_group_id,
    userId: row.user_id,
    originatingSignalIntentId:
      row.originating_signal_intent_id,
    state: row.state,
    isActiveCore: row.is_active_core,
    matchedAt: row.matched_at,
    confirmationDeadline:
      row.confirmation_deadline,
    confirmedAt: row.confirmed_at,
    endedAt: row.ended_at,
    replacementReason:
      row.replacement_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Fetch the complete browser-visible authoritative Signal snapshot.
 *
 * PostgreSQL RLS determines what the authenticated user may observe.
 * This function deliberately contains no matching or state-transition logic.
 */
export async function fetchSignalSnapshot(
  target: SignalRealtimeTarget,
  client: SupabaseClient = supabase,
): Promise<SignalSnapshot> {
  const [
    intentResult,
    groupResult,
    membershipsResult,
  ] = await Promise.all([
    client
      .from('signal_intents')
      .select(
        [
          'id',
          'user_id',
          'city_id',
          'activity_id',
          'vibe_id',
          'starts_at',
          'ends_at',
          'expires_at',
          'crowd_mode',
          'min_age',
          'max_age',
          'preferred_radius_miles',
          'journey_origin',
          'state',
          'created_at',
          'updated_at',
        ].join(','),
      )
      .eq('id', target.signalIntentId)
      .single(),

    client
      .from('signal_groups')
      .select(
        [
          'id',
          'city_id',
          'activity_id',
          'vibe_id',
          'grouping_policy_id',
          'starts_at',
          'ends_at',
          'expires_at',
          'crowd_mode',
          'min_age',
          'max_age',
          'state',
          'journey_stage',
          'confirmation_deadline',
          'coordination_deadline',
          'formed_at',
          'locked_at',
          'completed_at',
          'cancelled_at',
          'created_at',
          'updated_at',
        ].join(','),
      )
      .eq('id', target.signalGroupId)
      .single(),

    client
      .from('signal_group_memberships')
      .select(
        [
          'id',
          'signal_group_id',
          'user_id',
          'originating_signal_intent_id',
          'state',
          'is_active_core',
          'matched_at',
          'confirmation_deadline',
          'confirmed_at',
          'ended_at',
          'replacement_reason',
          'created_at',
          'updated_at',
        ].join(','),
      )
      .eq(
        'signal_group_id',
        target.signalGroupId,
      )
      .order('matched_at', {
        ascending: true,
      }),
  ])

  if (intentResult.error) {
    throw asError(
      intentResult.error,
      'Unable to load Signal intent',
    )
  }

  if (!intentResult.data) {
    throw new Error(
      'Signal intent is not visible to the current user',
    )
  }

  if (groupResult.error) {
    throw asError(
      groupResult.error,
      'Unable to load Signal group',
    )
  }

  if (!groupResult.data) {
    throw new Error(
      'Signal group is not visible to the current user',
    )
  }

  if (membershipsResult.error) {
    throw asError(
      membershipsResult.error,
      'Unable to load Signal memberships',
    )
  }

  const intent = mapIntent(
    intentResult.data as unknown as SignalIntentRow,
  )

  const group = mapGroup(
    groupResult.data as unknown as SignalGroupRow,
  )

  const memberships = (
    membershipsResult.data ?? []
  ).map((row) =>
    mapMembership(
      row as unknown as SignalMembershipRow,
    ),
  )

  return {
    intent,
    group,
    memberships,
    memberCount: memberships.filter(
      (membership) =>
        membership.state === 'matched' ||
        membership.state === 'confirmed',
    ).length,
    confirmedMemberCount:
      memberships.filter(
        (membership) =>
          membership.state === 'confirmed',
      ).length,
    activeCoreMemberCount:
      memberships.filter(
        (membership) =>
          membership.isActiveCore &&
          (
            membership.state === 'matched' ||
            membership.state === 'confirmed'
          ),
      ).length,
    fetchedAt: new Date().toISOString(),
  }
}

function normalizeConnectionState(
  status: string,
): SignalRealtimeConnectionState | null {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed'

    case 'CHANNEL_ERROR':
      return 'channel_error'

    case 'TIMED_OUT':
      return 'timed_out'

    case 'CLOSED':
      return 'closed'

    default:
      return null
  }
}

/**
 * Observe one authorized Signal.
 *
 * Realtime is intentionally an invalidation mechanism:
 * database events never become business truth directly.
 * Every relevant event causes a fresh RLS-protected snapshot read.
 *
 * Reaching SUBSCRIBED also refreshes the snapshot. That closes the
 * race between the initial read and subscription establishment and
 * also re-syncs after channel reconnection.
 */
export function subscribeToSignalRealtime(
  target: SignalRealtimeTarget,
  listener: SignalRealtimeListener,
  client: SupabaseClient = supabase,
): SignalRealtimeSubscription {
  let stopped = false
  let channel: RealtimeChannel | null = null
  let refreshRunning = false
  let refreshQueued = false

  const emitConnectionState = (
    state: SignalRealtimeConnectionState,
  ) => {
    if (stopped) return

    listener.onConnectionStateChange?.(
      state,
    )
  }

  const runRefresh = async () => {
    if (stopped) return

    if (refreshRunning) {
      refreshQueued = true
      return
    }

    refreshRunning = true

    try {
      do {
        refreshQueued = false

        const snapshot =
          await fetchSignalSnapshot(
            target,
            client,
          )

        if (!stopped) {
          listener.onSnapshot(snapshot)
        }
      } while (
        !stopped &&
        refreshQueued
      )
    } catch (error) {
      if (!stopped) {
        listener.onError?.(
          asError(
            error,
            'Unable to refresh Signal',
          ),
        )
      }
    } finally {
      refreshRunning = false
    }
  }

  const refresh = async () => {
    await runRefresh()
  }

  emitConnectionState('connecting')

  channel = client
    .channel(
      `signal:${target.signalGroupId}`,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'signal_intents',
        filter:
          `id=eq.${target.signalIntentId}`,
      },
      () => {
        void runRefresh()
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'signal_groups',
        filter:
          `id=eq.${target.signalGroupId}`,
      },
      () => {
        void runRefresh()
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table:
          'signal_group_memberships',
        filter:
          `signal_group_id=eq.${target.signalGroupId}`,
      },
      () => {
        void runRefresh()
      },
    )
    .subscribe((status) => {
      const normalized =
        normalizeConnectionState(status)

      if (normalized) {
        emitConnectionState(normalized)
      }

      if (status === 'SUBSCRIBED') {
        void runRefresh()
      }
    })

  /*
   * Initial authoritative read starts immediately.
   * SUBSCRIBED causes another read so changes between
   * this request and subscription establishment cannot
   * leave the UI stale.
   */
  void runRefresh()

  return {
    refresh,

    async stop() {
      if (stopped) return

      stopped = true

      const activeChannel = channel
      channel = null

      if (activeChannel) {
        await client.removeChannel(
          activeChannel,
        )
      }
    },
  }
}
