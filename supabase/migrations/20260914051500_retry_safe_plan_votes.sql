begin;

create or replace function public.vote_on_plan_join_request(
  p_request_id uuid,
  p_vote text
)
returns table (
  request_id uuid,
  request_state text,
  yes_votes integer,
  no_votes integer,
  majority_required integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_request public.plan_join_requests%rowtype;
  v_active_count integer;
  v_majority integer;
  v_state text;
  v_yes integer;
  v_no integer;
  v_existing_vote text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_join_vote' using errcode = '22023'; end if;

  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id = p_request_id
  for update;
  if not found then raise exception 'plan_join_request_not_found' using errcode = 'P0001'; end if;

  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id = v_request.plan_id
      and pm.user_id = v_user_id
      and pm.membership_state = 'active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode = '42501';
  end if;

  if v_request.state <> 'pending' then
    select pjr_vote.vote into v_existing_vote
    from public.plan_join_request_votes pjr_vote
    where pjr_vote.request_id=v_request.id and pjr_vote.user_id=v_user_id;
    if v_existing_vote is null or v_existing_vote <> p_vote then
      raise exception 'plan_join_request_not_pending' using errcode = 'P0001';
    end if;
    v_state := v_request.state;
  elsif v_request.expires_at <= v_now then
    v_state := public.reconcile_plan_join_request(v_request.id);
  else
    insert into public.plan_join_request_votes(request_id,user_id,vote,voted_at,updated_at)
    values (v_request.id,v_user_id,p_vote,v_now,v_now)
    on conflict on constraint plan_join_request_votes_pkey do update
    set vote = excluded.vote, voted_at = v_now, updated_at = v_now;
    v_state := public.reconcile_plan_join_request(v_request.id);
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_request.plan_id
    and pm.membership_state = 'active'::public.plan_membership_state
    and pm.user_id <> v_request.requester_user_id;
  v_majority := floor(v_active_count / 2.0)::integer + 1;

  select
    count(*) filter (where vote = 'yes')::integer,
    count(*) filter (where vote = 'no')::integer
  into v_yes,v_no
  from public.plan_join_request_votes pjr_vote
  where pjr_vote.request_id = v_request.id;

  return query select v_request.id, v_state, v_yes, v_no, v_majority;
end;
$function$;

create or replace function public.vote_on_plan_change(p_proposal_id uuid,p_vote text)
returns table(proposal_id uuid,proposal_state text,yes_votes integer,no_votes integer,majority_required integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_proposal public.plan_change_proposals%rowtype;
  v_active integer;
  v_majority integer;
  v_state text;
  v_yes integer;
  v_no integer;
  v_existing_vote text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_plan_change_vote' using errcode='22023'; end if;

  select pcp.* into v_proposal from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id for update;
  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;

  if not public.is_active_plan_member(v_proposal.plan_id) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  if v_proposal.state <> 'pending' then
    select pcv.vote into v_existing_vote
    from public.plan_change_votes pcv
    where pcv.proposal_id=v_proposal.id and pcv.user_id=v_user_id;
    if v_existing_vote is null or v_existing_vote <> p_vote then
      raise exception 'plan_change_proposal_not_pending' using errcode='P0001';
    end if;
    v_state := v_proposal.state;
  elsif v_proposal.expires_at <= v_now then
    v_state := public.reconcile_plan_change_proposal(v_proposal.id);
  else
    insert into public.plan_change_votes(proposal_id,user_id,vote,voted_at,updated_at)
    values(v_proposal.id,v_user_id,p_vote,v_now,v_now)
    on conflict on constraint plan_change_votes_pkey do update
      set vote=excluded.vote,voted_at=v_now,updated_at=v_now;
    v_state := public.reconcile_plan_change_proposal(v_proposal.id);
  end if;

  select count(*)::integer into v_active
  from public.plan_memberships pm
  where pm.plan_id=v_proposal.plan_id and pm.membership_state='active'::public.plan_membership_state;
  v_majority := floor(v_active/2.0)::integer+1;

  select
    count(*) filter(where pcv.vote='yes')::integer,
    count(*) filter(where pcv.vote='no')::integer
  into v_yes,v_no
  from public.plan_change_votes pcv
  where pcv.proposal_id=v_proposal.id;

  return query select v_proposal.id,v_state,v_yes,v_no,v_majority;
end;
$function$;

alter function public.vote_on_plan_join_request(uuid,text) owner to postgres;
alter function public.vote_on_plan_change(uuid,text) owner to postgres;
revoke all on function public.vote_on_plan_join_request(uuid,text) from public,anon;
revoke all on function public.vote_on_plan_change(uuid,text) from public,anon;
grant execute on function public.vote_on_plan_join_request(uuid,text) to authenticated;
grant execute on function public.vote_on_plan_change(uuid,text) to authenticated;

comment on function public.vote_on_plan_join_request(uuid,text)
is 'Records or changes a pending join-request vote; an identical retry after resolution returns the resolved snapshot without reopening the decision.';
comment on function public.vote_on_plan_change(uuid,text)
is 'Records or changes a pending Plan-change vote; an identical retry after resolution returns the resolved snapshot without reopening the decision.';

commit;
