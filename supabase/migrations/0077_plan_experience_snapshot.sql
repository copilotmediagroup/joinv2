begin;

create or replace function public.get_my_plan_governance(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_plan public.plans%rowtype;
  v_active_count integer;
  v_conversation_id uuid;
  v_join jsonb;
  v_change jsonb;
  v_activity_name text;
  v_city_name text;
  v_state_code text;
  v_venue_name text;
  v_venue_address text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_plan_id is null then raise exception 'plan_id_required' using errcode='22023'; end if;

  select p.* into v_plan from public.plans p where p.id=p_plan_id;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id=v_plan.id and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.membership_state='active'::public.plan_membership_state;

  select c.id into v_conversation_id from public.conversations c where c.plan_id=v_plan.id;

  select a.name,c.name,s.code
  into v_activity_name,v_city_name,v_state_code
  from public.activities a
  join public.cities c on c.id=v_plan.city_id
  join public.states s on s.id=c.state_id
  where a.id=v_plan.activity_id;

  select v.name,
         concat_ws(', ',nullif(v.address_line1,''),nullif(v.address_line2,''),v.postal_code)
  into v_venue_name,v_venue_address
  from public.venues v
  where v.id=v_plan.current_venue_id;
  select jsonb_build_object(
    'requestId',pjr.id,
    'requesterUserId',pjr.requester_user_id,
    'requesterName',coalesce(up.display_name,'SIGNAL member'),
    'state',pjr.state,
    'requestedAt',pjr.requested_at,
    'expiresAt',pjr.expires_at,
    'yesVotes',(select count(*) from public.plan_join_request_votes v where v.request_id=pjr.id and v.vote='yes'),
    'noVotes',(select count(*) from public.plan_join_request_votes v where v.request_id=pjr.id and v.vote='no'),
    'majorityRequired',floor(v_active_count/2.0)::integer+1,
    'myVote',(select v.vote from public.plan_join_request_votes v where v.request_id=pjr.id and v.user_id=v_user_id)
  ) into v_join
  from public.plan_join_requests pjr
  join public.user_profiles up on up.user_id=pjr.requester_user_id
  where pjr.plan_id=v_plan.id and pjr.state='pending'
  order by pjr.requested_at,pjr.id
  limit 1;

  select jsonb_build_object(
    'proposalId',pcp.id,
    'proposerUserId',pcp.proposer_user_id,
    'proposerName',coalesce(up.display_name,'SIGNAL member'),
    'changeType',pcp.change_type,
    'proposedVenueId',pcp.proposed_venue_id,
    'proposedVenueName',v.name,
    'proposedStartsAt',pcp.proposed_starts_at,
    'state',pcp.state,
    'proposedAt',pcp.proposed_at,
    'expiresAt',pcp.expires_at,
    'yesVotes',(select count(*) from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.vote='yes'),
    'noVotes',(select count(*) from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.vote='no'),
    'majorityRequired',floor(v_active_count/2.0)::integer+1,
    'myVote',(select cv.vote from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.user_id=v_user_id)
  ) into v_change
  from public.plan_change_proposals pcp
  join public.user_profiles up on up.user_id=pcp.proposer_user_id
  left join public.venues v on v.id=pcp.proposed_venue_id
  where pcp.plan_id=v_plan.id and pcp.state='pending'
  order by pcp.proposed_at,pcp.id
  limit 1;

  return jsonb_build_object(
    'planId',v_plan.id,
    'state',v_plan.state,
    'title',v_plan.title,
    'activityName',v_activity_name,
    'cityName',v_city_name,
    'stateCode',v_state_code,
    'capacity',v_plan.capacity,
    'activeMemberCount',v_active_count,
    'admissionMode',v_plan.admission_mode,
    'scheduledStartsAt',v_plan.scheduled_starts_at,
    'scheduledEndsAt',v_plan.scheduled_ends_at,
    'currentVenueId',v_plan.current_venue_id,
    'currentVenueName',v_venue_name,
    'currentVenueAddress',v_venue_address,
    'conversationId',v_conversation_id,
    'changeFreezeAt',case when v_plan.scheduled_starts_at is null then null else v_plan.scheduled_starts_at-interval '30 minutes' end,
    'joinRequest',v_join,
    'changeProposal',v_change
  );
end;
$function$;

alter function public.get_my_plan_governance(uuid) owner to postgres;
revoke all on function public.get_my_plan_governance(uuid) from public,anon;
grant execute on function public.get_my_plan_governance(uuid) to authenticated;

comment on function public.get_my_plan_governance(uuid)
is 'Returns the caller authoritative Plan experience snapshot, including meetup identity, place, time, membership, governance, and active controls.';

commit;
