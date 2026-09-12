import { supabase } from '../../lib/supabaseClient'

export type PlanGovernanceVote = 'yes' | 'no'

export class PlanAccessLostError extends Error {
  constructor(message = 'This Plan is no longer available to you.') {
    super(message)
    this.name = 'PlanAccessLostError'
  }
}

function isPlanAccessLost(message: string): boolean {
  return ['plan_membership_required', 'active_plan_membership_not_found', 'plan_not_found'].some((code) => message.includes(code))
}

export type PlanReplacementStatus = {
  state: 'open' | 'filled' | 'timed_out' | 'cancelled'
  deadlineAt: string
  requiredActiveCount: number
  activeMemberCount: number
}

export type PlanReplacementClaim = {
  planId: string | null
  claimed: boolean
}

export type PlanJoinRequestSnapshot = {
  requestId: string
  requesterUserId: string
  requesterName: string
  state: string
  requestedAt: string
  expiresAt: string | null
  yesVotes: number
  noVotes: number
  majorityRequired: number
  myVote: PlanGovernanceVote | null
}

export type PlanChangeProposalSnapshot = {
  proposalId: string
  proposerUserId: string
  proposerName: string
  changeType: 'venue' | 'time'
  proposedVenueId: string | null
  proposedVenueName: string | null
  proposedStartsAt: string | null
  state: string
  proposedAt: string
  expiresAt: string
  yesVotes: number
  noVotes: number
  majorityRequired: number
  myVote: PlanGovernanceVote | null
}

export type PlanGovernanceSnapshot = {
  planId: string
  state: string
  title: string | null
  capacity: number
  activeMemberCount: number
  admissionMode: string
  scheduledStartsAt: string | null
  scheduledEndsAt: string | null
  currentVenueId: string | null
  conversationId: string | null
  changeFreezeAt: string | null
  joinRequest: PlanJoinRequestSnapshot | null
  changeProposal: PlanChangeProposalSnapshot | null
}

export async function getMyPlanGovernance(planId: string): Promise<PlanGovernanceSnapshot> {
  const { data, error } = await supabase.rpc('get_my_plan_governance', {
    p_plan_id: planId,
  })
  if (error) {
    const message = error.message || ''
    if (isPlanAccessLost(message)) throw new PlanAccessLostError()
    throw new Error('We couldn’t refresh this Plan right now. Please try again.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Plan controls returned an invalid response')
  }
  return data as PlanGovernanceSnapshot
}

export async function voteOnPlanJoinRequest(
  requestId: string,
  vote: PlanGovernanceVote,
): Promise<void> {
  const { error } = await supabase.rpc('vote_on_plan_join_request', {
    p_request_id: requestId,
    p_vote: vote,
  })
  if (error) throw new Error(error.message || 'Unable to vote on join request')
}

export async function voteOnPlanChange(
  proposalId: string,
  vote: PlanGovernanceVote,
): Promise<void> {
  const { error } = await supabase.rpc('vote_on_plan_change', {
    p_proposal_id: proposalId,
    p_vote: vote,
  })
  if (error) throw new Error(error.message || 'Unable to vote on Plan change')
}

export async function proposePlanTimeChange(
  planId: string,
  startsAt: string,
): Promise<void> {
  const { error } = await supabase.rpc('propose_plan_change', {
    p_plan_id: planId,
    p_change_type: 'time',
    p_proposed_venue_id: null,
    p_proposed_starts_at: startsAt,
  })
  if (error) throw new Error(error.message || 'Unable to propose a new meetup time')
}

export async function leaveMyPlan(planId: string): Promise<void> {
  const { data, error } = await supabase.rpc('leave_my_plan', {
    p_plan_id: planId,
  })
  if (error) throw new Error(error.message || 'Unable to leave this Plan')
  if (data !== true) throw new Error('Plan departure returned an invalid response')
}

export async function getMyPlanReplacementStatus(planId: string): Promise<PlanReplacementStatus | null> {
  const { data, error } = await supabase.rpc('get_my_plan_replacement_status', { p_plan_id: planId })
  if (error) throw new Error('Unable to check replacement status.')
  if (data === null) return null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unable to check replacement status.')
  return data as PlanReplacementStatus
}

export async function claimMatchingPlanReplacement(input: {
  citySlug: string
  activitySlug: string
  timeWindow: string
  crowdMode: 'everyone' | 'women_only' | 'men_only'
  minAge: number | null
  maxAge: number | null
}): Promise<PlanReplacementClaim> {
  const { data, error } = await supabase.rpc('claim_matching_plan_replacement', {
    p_city_slug: input.citySlug,
    p_activity_slug: input.activitySlug,
    p_time_window: input.timeWindow,
    p_crowd_mode: input.crowdMode,
    p_min_age: input.minAge,
    p_max_age: input.maxAge,
  })
  if (error) throw new Error('Unable to check for an open Signal seat.')
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { planId: null, claimed: false }
  return {
    planId: typeof row.plan_id === 'string' ? row.plan_id : null,
    claimed: row.claimed === true,
  }
}

export function subscribeToPlanGovernance(
  planId: string,
  onInvalidate: () => void,
): () => void {
  const channel = supabase
    .channel(`plan-governance:${planId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'plan_join_requests',
      filter: `plan_id=eq.${planId}`,
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'plan_join_request_votes',
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'plan_change_proposals',
      filter: `plan_id=eq.${planId}`,
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'plan_change_votes',
    }, onInvalidate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'plan_memberships',
      filter: `plan_id=eq.${planId}`,
    }, onInvalidate)
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
