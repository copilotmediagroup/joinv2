import { supabase } from '../../lib/supabaseClient'

export type PlanGovernanceVote = 'yes' | 'no'

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
  if (error) throw new Error(error.message || 'Unable to load Plan controls')
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
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
