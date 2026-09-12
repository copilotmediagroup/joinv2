begin;

-- ============================================================
-- SIGNAL
-- Migration 0036
-- Group-majority Plan change voting
-- ============================================================
-- Any active member may propose one venue or time change at a
-- time. Voting lasts five minutes, requires >50% of current
-- active members, and freezes 30 minutes before meetup.
-- ============================================================

create table if not exists public.plan_change_proposals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  proposer_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  change_type text not null,
  proposed_venue_id uuid null references public.venues(id),
  proposed_starts_at timestamptz null,
  state text not null default 'pending',
  proposed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  resolution_reason text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint plan_change_proposals_type_check check (change_type in ('venue','time')),
  constraint plan_change_proposals_state_check check (state in ('pending','approved','rejected','expired','cancelled')),
  constraint plan_change_proposals_payload_check check (
    (change_type='venue' and proposed_venue_id is not null and proposed_starts_at is null)
    or
    (change_type='time' and proposed_venue_id is null and proposed_starts_at is not null)
  ),
  constraint plan_change_proposals_window_check check (expires_at > proposed_at)
);

create unique index if not exists plan_change_proposals_one_pending_per_plan
  on public.plan_change_proposals(plan_id)
  where state='pending';

create index if not exists plan_change_proposals_plan_history_idx
  on public.plan_change_proposals(plan_id, proposed_at desc, id);

create table if not exists public.plan_change_votes (
  proposal_id uuid not null references public.plan_change_proposals(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  vote text not null,
  voted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (proposal_id,user_id),
  constraint plan_change_votes_vote_check check (vote in ('yes','no'))
);

alter table public.plan_change_proposals enable row level security;
alter table public.plan_change_votes enable row level security;

create policy plan_change_proposals_select_members
on public.plan_change_proposals
for select to authenticated
using (public.is_active_plan_member(plan_id));

create policy plan_change_votes_select_members
on public.plan_change_votes
for select to authenticated
using (
  exists (
    select 1 from public.plan_change_proposals pcp
    where pcp.id = plan_change_votes.proposal_id
      and public.is_active_plan_member(pcp.plan_id)
  )
);

revoke all on table public.plan_change_proposals from anon;
revoke all on table public.plan_change_votes from anon;
revoke insert,update,delete on table public.plan_change_proposals from authenticated;
revoke insert,update,delete on table public.plan_change_votes from authenticated;
grant select on table public.plan_change_proposals to authenticated;
grant select on table public.plan_change_votes to authenticated;

create or replace function public.reconcile_plan_change_proposal(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_proposal public.plan_change_proposals%rowtype;
  v_plan public.plans%rowtype;
  v_active_count integer;
  v_majority integer;
  v_yes integer;
  v_no integer;
  v_duration interval;
  v_previous_venue uuid;
  v_previous_start timestamptz;
begin
  select pcp.* into v_proposal
  from public.plan_change_proposals pcp
  where pcp.id = p_proposal_id
  for update;

  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;
  if v_proposal.state <> 'pending' then return v_proposal.state; end if;

  select p.* into v_plan from public.plans p where p.id=v_proposal.plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.membership_state='active'::public.plan_membership_state;
  v_majority := floor(v_active_count/2.0)::integer + 1;

  select
    count(*) filter (where pcv.vote='yes')::integer,
    count(*) filter (where pcv.vote='no')::integer
  into v_yes,v_no
  from public.plan_change_votes pcv
  where pcv.proposal_id=v_proposal.id
    and exists (
      select 1 from public.plan_memberships pm
      where pm.plan_id=v_plan.id and pm.user_id=pcv.user_id
        and pm.membership_state='active'::public.plan_membership_state
    );

  if v_plan.state in ('completed'::public.plan_state,'cancelled'::public.plan_state,'active_outing'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    update public.plan_change_proposals
    set state='expired',resolved_at=v_now,resolution_reason='change_window_closed',updated_at=v_now
    where id=v_proposal.id;
    return 'expired';
  end if;

  if v_yes >= v_majority then
    v_previous_venue := v_plan.current_venue_id;
    v_previous_start := v_plan.scheduled_starts_at;

    if v_proposal.change_type='venue' then
      if not exists (select 1 from public.venues v where v.id=v_proposal.proposed_venue_id) then
        raise exception 'proposed_venue_not_found' using errcode='P0001';
      end if;
      update public.plans
      set current_venue_id=v_proposal.proposed_venue_id,updated_at=v_now
      where id=v_plan.id;

      insert into public.plan_history(
        plan_id,event_type,actor_user_id,previous_venue_id,new_venue_id,reason,metadata,occurred_at
      ) values (
        v_plan.id,'venue_changed',v_proposal.proposer_user_id,
        v_previous_venue,v_proposal.proposed_venue_id,'group_vote',
        jsonb_build_object('proposal_id',v_proposal.id,'yes_votes',v_yes,'eligible_members',v_active_count),v_now
      );
    else
      if v_proposal.proposed_starts_at <= v_now + interval '30 minutes' then
        update public.plan_change_proposals
        set state='rejected',resolved_at=v_now,resolution_reason='proposed_time_too_soon',updated_at=v_now
        where id=v_proposal.id;
        return 'rejected';
      end if;

      v_duration := greatest(
        coalesce(v_plan.scheduled_ends_at-v_plan.scheduled_starts_at,interval '2 hours'),
        interval '30 minutes'
      );

      update public.plans
      set scheduled_starts_at=v_proposal.proposed_starts_at,
          scheduled_ends_at=v_proposal.proposed_starts_at+v_duration,
          updated_at=v_now
      where id=v_plan.id;

      insert into public.plan_history(
        plan_id,event_type,actor_user_id,previous_starts_at,new_starts_at,reason,metadata,occurred_at
      ) values (
        v_plan.id,'time_changed',v_proposal.proposer_user_id,
        v_previous_start,v_proposal.proposed_starts_at,'group_vote',
        jsonb_build_object('proposal_id',v_proposal.id,'yes_votes',v_yes,'eligible_members',v_active_count),v_now
      );
    end if;

    update public.plan_change_proposals
    set state='approved',resolved_at=v_now,resolution_reason='group_majority',updated_at=v_now
    where id=v_proposal.id;
    return 'approved';
  end if;

  if v_no >= v_majority or v_proposal.expires_at <= v_now then
    update public.plan_change_proposals
    set state='rejected',resolved_at=v_now,
        resolution_reason=case when v_no>=v_majority then 'group_majority_no' else 'vote_timeout' end,
        updated_at=v_now
    where id=v_proposal.id;
    return 'rejected';
  end if;

  return 'pending';
end;
$function$;

alter function public.reconcile_plan_change_proposal(uuid) owner to postgres;
revoke all on function public.reconcile_plan_change_proposal(uuid) from public,anon,authenticated;

create or replace function public.propose_plan_change(
  p_plan_id uuid,
  p_change_type text,
  p_proposed_venue_id uuid default null,
  p_proposed_starts_at timestamptz default null
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
  if p_change_type not in ('venue','time') then raise exception 'invalid_plan_change_type' using errcode='22023'; end if;

  select p.* into v_plan from public.plans p where p.id=p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;

  if not public.is_active_plan_member(v_plan.id) then
    raise exception 'plan_membership_required' using errcode='42501';
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
    if p_proposed_venue_id = v_plan.current_venue_id then
      raise exception 'venue_change_matches_current' using errcode='22023';
    end if;
  else
    if p_proposed_starts_at is null or p_proposed_venue_id is not null then
      raise exception 'time_change_requires_only_time' using errcode='22023';
    end if;
    if p_proposed_starts_at <= v_now + interval '30 minutes' then
      raise exception 'proposed_time_too_soon' using errcode='22023';
    end if;
  end if;

  insert into public.plan_change_proposals(
    plan_id,proposer_user_id,change_type,proposed_venue_id,proposed_starts_at,
    state,proposed_at,expires_at,created_at,updated_at
  ) values (
    v_plan.id,v_user_id,p_change_type,p_proposed_venue_id,p_proposed_starts_at,
    'pending',v_now,v_now+interval '5 minutes',v_now,v_now
  ) returning * into v_proposal;

  return query select v_proposal.id,v_proposal.state,v_proposal.expires_at;
end;
$function$;

alter function public.propose_plan_change(uuid,text,uuid,timestamptz) owner to postgres;
revoke all on function public.propose_plan_change(uuid,text,uuid,timestamptz) from public,anon;
grant execute on function public.propose_plan_change(uuid,text,uuid,timestamptz) to authenticated;

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
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_plan_change_vote' using errcode='22023'; end if;

  select pcp.* into v_proposal from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id for update;
  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;
  if v_proposal.state<>'pending' then raise exception 'plan_change_proposal_not_pending' using errcode='P0001'; end if;

  if not public.is_active_plan_member(v_proposal.plan_id) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  if v_proposal.expires_at <= v_now then
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

alter function public.vote_on_plan_change(uuid,text) owner to postgres;
revoke all on function public.vote_on_plan_change(uuid,text) from public,anon;
grant execute on function public.vote_on_plan_change(uuid,text) to authenticated;

create or replace function public.reconcile_my_plan_change(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select plan_id into v_plan_id from public.plan_change_proposals where id=p_proposal_id;
  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;
  if not public.is_active_plan_member(v_plan_id) then raise exception 'plan_membership_required' using errcode='42501'; end if;
  return public.reconcile_plan_change_proposal(p_proposal_id);
end;
$function$;

alter function public.reconcile_my_plan_change(uuid) owner to postgres;
revoke all on function public.reconcile_my_plan_change(uuid) from public,anon;
grant execute on function public.reconcile_my_plan_change(uuid) to authenticated;

commit;
