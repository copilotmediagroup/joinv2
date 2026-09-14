begin;

alter table public.plan_change_proposals
  add column if not exists client_proposal_id uuid;

create unique index if not exists plan_change_proposals_proposer_client_key
  on public.plan_change_proposals(proposer_user_id, client_proposal_id)
  where client_proposal_id is not null;

create or replace function public.propose_plan_change_v2(
  p_plan_id uuid,
  p_change_type text,
  p_proposed_venue_id uuid default null,
  p_proposed_starts_at timestamptz default null,
  p_client_proposal_id uuid default null
)
returns table(proposal_id uuid,proposal_state text,expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_plan public.plans%rowtype;
  v_proposal public.plan_change_proposals%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_client_proposal_id is null then raise exception 'client_proposal_id_required' using errcode='22023'; end if;
  if p_change_type not in ('venue','time') then raise exception 'invalid_plan_change_type' using errcode='22023'; end if;

  select * into v_proposal
  from public.plan_change_proposals pcp
  where pcp.proposer_user_id=v_user_id
    and pcp.client_proposal_id=p_client_proposal_id;
  if found then
    if v_proposal.plan_id<>p_plan_id
      or v_proposal.change_type<>p_change_type
      or v_proposal.proposed_venue_id is distinct from p_proposed_venue_id
      or v_proposal.proposed_starts_at is distinct from p_proposed_starts_at then
      raise exception 'plan_change_idempotency_key_conflict' using errcode='22023';
    end if;
    return query select v_proposal.id,v_proposal.state,v_proposal.expires_at;
    return;
  end if;

  select p.* into v_plan from public.plans p where p.id=p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  if not public.is_active_plan_member(v_plan.id) then raise exception 'plan_membership_required' using errcode='42501'; end if;

  select * into v_proposal
  from public.plan_change_proposals pcp
  where pcp.proposer_user_id=v_user_id
    and pcp.client_proposal_id=p_client_proposal_id;
  if found then
    if v_proposal.plan_id<>p_plan_id
      or v_proposal.change_type<>p_change_type
      or v_proposal.proposed_venue_id is distinct from p_proposed_venue_id
      or v_proposal.proposed_starts_at is distinct from p_proposed_starts_at then
      raise exception 'plan_change_idempotency_key_conflict' using errcode='22023';
    end if;
    return query select v_proposal.id,v_proposal.state,v_proposal.expires_at;
    return;
  end if;

  if v_plan.state in ('completed'::public.plan_state,'cancelled'::public.plan_state,'active_outing'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    raise exception 'plan_change_window_closed' using errcode='P0001';
  end if;
  if exists (select 1 from public.plan_change_proposals where plan_id=v_plan.id and state='pending') then
    raise exception 'plan_change_vote_already_open' using errcode='P0001';
  end if;

  if p_change_type='venue' then
    if p_proposed_venue_id is null or p_proposed_starts_at is not null then
      raise exception 'venue_change_requires_only_venue' using errcode='22023';
    end if;
    if p_proposed_venue_id = v_plan.current_venue_id then raise exception 'venue_change_matches_current' using errcode='22023'; end if;
  else
    if p_proposed_starts_at is null or p_proposed_venue_id is not null then
      raise exception 'time_change_requires_only_time' using errcode='22023';
    end if;
    if p_proposed_starts_at <= v_now + interval '30 minutes' then raise exception 'proposed_time_too_soon' using errcode='22023'; end if;
  end if;

  insert into public.plan_change_proposals(
    plan_id,proposer_user_id,change_type,proposed_venue_id,proposed_starts_at,
    state,proposed_at,expires_at,created_at,updated_at,client_proposal_id
  ) values (
    v_plan.id,v_user_id,p_change_type,p_proposed_venue_id,p_proposed_starts_at,
    'pending',v_now,v_now+interval '5 minutes',v_now,v_now,p_client_proposal_id
  ) returning * into v_proposal;

  return query select v_proposal.id,v_proposal.state,v_proposal.expires_at;
end;
$function$;

alter function public.propose_plan_change_v2(uuid,text,uuid,timestamptz,uuid) owner to postgres;
revoke all on function public.propose_plan_change_v2(uuid,text,uuid,timestamptz,uuid) from public,anon;
grant execute on function public.propose_plan_change_v2(uuid,text,uuid,timestamptz,uuid) to authenticated;

comment on function public.propose_plan_change_v2(uuid,text,uuid,timestamptz,uuid)
is 'Creates one Plan-change proposal per client submission token. Identical retries return the existing proposal without reopening or duplicating it.';

commit;
