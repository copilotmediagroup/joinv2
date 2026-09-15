export type SignalIntentState =
  | 'active'
  | 'assigned'
  | 'withdrawn'
  | 'expired'

export type SignalJourneyStage =
  | 'forming'
  | 'arrival'
  | 'places'
  | 'time'
  | 'plan'
  | 'active_outing'
  | 'completed'

export type SignalGroupState =
  | 'forming'
  | 'confirming'
  | 'coordinating'
  | 'locked'
  | 'active_outing'
  | 'completed'
  | 'cancelled'
  | 'expired'

export type SignalGroupMembershipState =
  | 'matched'
  | 'confirmed'
  | 'declined'
  | 'timed_out'
  | 'withdrawn'
  | 'replaced'

export type SignalCrowdMode =
  | 'everyone'
  | 'women_only'
  | 'men_only'

export type SignalJourneyOrigin =
  | 'direct_signal'
  | 'im_bored'
  | 'manual_plan'

export type SignalRealtimeTarget = {
  signalIntentId: string
  signalGroupId: string
}

export type SignalIntentSnapshot = {
  id: string
  userId: string
  cityId: string
  activityId: string
  vibeId: string | null
  startsAt: string
  endsAt: string
  expiresAt: string
  crowdMode: SignalCrowdMode
  minAge: number | null
  maxAge: number | null
  preferredRadiusMiles: number | null
  journeyOrigin: SignalJourneyOrigin
  state: SignalIntentState
  createdAt: string
  updatedAt: string
}

export type SignalGroupSnapshot = {
  id: string
  cityId: string
  activityId: string
  vibeId: string | null
  groupingPolicyId: string
  startsAt: string
  endsAt: string
  expiresAt: string
  crowdMode: SignalCrowdMode
  minAge: number | null
  maxAge: number | null
  state: SignalGroupState
  journeyStage: SignalJourneyStage
  confirmationDeadline: string | null
  coordinationDeadline: string | null
  formedAt: string | null
  lockedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export type SignalGroupMembershipSnapshot = {
  id: string
  signalGroupId: string
  userId: string
  originatingSignalIntentId: string
  state: SignalGroupMembershipState
  isActiveCore: boolean
  matchedAt: string
  confirmationDeadline: string | null
  confirmedAt: string | null
  endedAt: string | null
  replacementReason: string | null
  createdAt: string
  updatedAt: string
}

export type SignalSnapshot = {
  intent: SignalIntentSnapshot
  group: SignalGroupSnapshot
  memberships: SignalGroupMembershipSnapshot[]
  memberCount: number
  confirmedMemberCount: number
  activeCoreMemberCount: number
  fetchedAt: string
}

export type SignalRealtimeConnectionState =
  | 'connecting'
  | 'subscribed'
  | 'channel_error'
  | 'timed_out'
  | 'closed'

export type SignalRealtimeListener = {
  onSnapshot: (snapshot: SignalSnapshot) => void
  onError?: (error: Error) => void
  onConnectionStateChange?: (
    state: SignalRealtimeConnectionState,
  ) => void
}

export type SignalRealtimeSubscription = {
  refresh: () => Promise<void>
  stop: () => Promise<void>
}
