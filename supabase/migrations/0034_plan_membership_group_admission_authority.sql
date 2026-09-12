begin;

-- ============================================================
-- SIGNAL
-- Migration 0034
-- Plan membership + group-vote admission authority
-- ============================================================
-- Signal-created Plans have no human owner. PostgreSQL owns the
-- request queue, 10-minute admission vote, >50% approval rule,
-- capacity revalidation, conversation access, and voluntary leave.
-- A Plan persists if members leave; falling below the original
-- Signal threshold does not cancel the Plan.
-- ============================================================

create table if not exists public.plan_join_requests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  requester_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  state text not null,
  requested_at timestamptz not null default clock_timestamp(),
  voting_started_at timestamptz null,
  expires_at timestamptz null,
  resolved_at timestamptz null,
  resolution_reason text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint plan_join_requests_state_check
    check (state in ('queued','pending','approved','rejected','expired','cancelled')),
  constraint plan_join_requests_pending_window_check
    check (
      (state = 'pending' and voting_started_at is not null and expires_at is not null)
      or state <> 'pending'
    )
);

create unique index if not exists plan_join_requests_one_pending_per_plan
  on public.plan_join_requests(plan_id)
  where state = 'pending';

create unique index if not exists plan_join_requests_one_open_per_requester
  on public.plan_join_requests(plan_id, requester_user_id)
  where state in ('queued','pending');

create index if not exists plan_join_requests_queue_idx
  on public.plan_join_requests(plan_id, state, requested_at, id);

create table if not exists public.plan_join_request_votes (
  request_id uuid not null references public.plan_join_requests(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  vote text not null,
  voted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (request_id, user_id),
  constraint plan_join_request_votes_vote_check check (vote in ('yes','no'))
);

alter table public.plan_join_requests enable row level security;
alter table public.plan_join_request_votes enable row level security;

create or replace function public.is_active_plan_member(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.plan_memberships pm
    where pm.plan_id = p_plan_id
      and pm.user_id = auth.uid()
      and pm.membership_state = 'active'::public.plan_membership_state
  );
$$;

alter function public.is_active_plan_member(uuid) owner to postgres;
revoke all on function public.is_active_plan_member(uuid) from public, anon;
grant execute on function public.is_active_plan_member(uuid) to authenticated;

create policy plan_join_requests_select_authorized
on public.plan_join_requests
for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.is_active_plan_member(plan_id)
);

create policy plan_join_request_votes_select_members
on public.plan_join_request_votes
for select to authenticated
using (
  exists (
    select 1
    from public.plan_join_requests pjr
    where pjr.id = plan_join_request_votes.request_id
      and public.is_active_plan_member(pjr.plan_id)
  )
);

revoke all on table public.plan_join_requests from anon;
revoke all on table public.plan_join_request_votes from anon;
revoke insert, update, delete on table public.plan_join_requests from authenticated;
revoke insert, update, delete on table public.plan_join_request_votes from authenticated;
grant select on table public.plan_join_requests to authenticated;
grant select on table public.plan_join_request_votes to authenticated;

create or replace function public.promote_next_plan_join_request(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_request_id uuid;
begin
  if exists (
    select 1 from public.plan_join_requests
    where plan_id = p_plan_id and state = 'pending'
  ) then
    return null;
  end if;

  select pjr.id into v_request_id
  from public.plan_join_requests pjr
  where pjr.plan_id = p_plan_id
    and pjr.state = 'queued'
  order by pjr.requested_at, pjr.id
  limit 1
  for update skip locked;

  if v_request_id is not null then
    update public.plan_join_requests
    set state = 'pending',
        voting_started_at = v_now,
        expires_at = v_now + interval '10 minutes',
        updated_at = v_now
    where id = v_request_id;
  end if;

  return v_request_id;
end;
$function$;

alter function public.promote_next_plan_join_request(uuid) owner to postgres;
revoke all on function public.promote_next_plan_join_request(uuid) from public, anon, authenticated;

create or replace function public.reconcile_plan_join_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.plan_join_requests%rowtype;
  v_plan public.plans%rowtype;
  v_active_count integer;
  v_majority_required integer;
  v_yes integer;
  v_no integer;
  v_conversation_id uuid;
begin
  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id = p_request_id
  for update;

  if not found then
    raise exception 'plan_join_request_not_found' using errcode = 'P0001';
  end if;

  if v_request.state <> 'pending' then
    return v_request.state;
  end if;

  select p.* into v_plan
  from public.plans p
  where p.id = v_request.plan_id
  for update;

  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_plan.id
    and pm.membership_state = 'active'::public.plan_membership_state;

  v_majority_required := floor(v_active_count / 2.0)::integer + 1;

  select
    count(*) filter (where pjr_vote.vote = 'yes')::integer,
    count(*) filter (where pjr_vote.vote = 'no')::integer
  into v_yes, v_no
  from public.plan_join_request_votes pjr_vote
  where pjr_vote.request_id = v_request.id
    and exists (
      select 1 from public.plan_memberships pm
      where pm.plan_id = v_plan.id
        and pm.user_id = pjr_vote.user_id
        and pm.membership_state = 'active'::public.plan_membership_state
    );

  if v_plan.state in ('completed'::public.plan_state, 'cancelled'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    update public.plan_join_requests
    set state = 'expired', resolved_at = v_now,
        resolution_reason = 'admission_window_closed', updated_at = v_now
    where id = v_request.id;
    perform public.promote_next_plan_join_request(v_plan.id);
    return 'expired';
  end if;

  if v_active_count >= v_plan.capacity then
    update public.plan_join_requests
    set state = 'rejected', resolved_at = v_now,
        resolution_reason = 'capacity_full', updated_at = v_now
    where id = v_request.id;
    perform public.promote_next_plan_join_request(v_plan.id);
    return 'rejected';
  end if;

  if v_yes >= v_majority_required then
    insert into public.plan_memberships (
      plan_id, user_id, membership_state, admission_origin,
      joined_at, locked_member, withdrawn_at, created_at, updated_at
    ) values (
      v_plan.id, v_request.requester_user_id, 'active', 'group_vote',
      v_now, false, null, v_now, v_now
    )
    on conflict (plan_id, user_id) do update
    set membership_state = 'active',
        admission_origin = 'group_vote',
        joined_at = v_now,
        locked_member = false,
        withdrawn_at = null,
        updated_at = v_now;

    select c.id into v_conversation_id
    from public.conversations c
    where c.plan_id = v_plan.id;

    if v_conversation_id is null then
      raise exception 'plan_conversation_not_found' using errcode = 'P0001';
    end if;

    insert into public.conversation_membership_intervals (
      conversation_id, user_id, started_at, created_at
    )
    select v_conversation_id, v_request.requester_user_id, v_now, v_now
    where not exists (
      select 1 from public.conversation_membership_intervals cmi
      where cmi.conversation_id = v_conversation_id
        and cmi.user_id = v_request.requester_user_id
        and cmi.ended_at is null
    );

    update public.plan_join_requests
    set state = 'approved', resolved_at = v_now,
        resolution_reason = 'group_majority', updated_at = v_now
    where id = v_request.id;

    perform public.promote_next_plan_join_request(v_plan.id);
    return 'approved';
  end if;

  if v_no >= v_majority_required
     or (v_request.expires_at is not null and v_request.expires_at <= v_now) then
    update public.plan_join_requests
    set state = 'rejected', resolved_at = v_now,
        resolution_reason = case
          when v_no >= v_majority_required then 'group_majority_no'
          else 'vote_timeout'
        end,
        updated_at = v_now
    where id = v_request.id;

    perform public.promote_next_plan_join_request(v_plan.id);
    return 'rejected';
  end if;

  return 'pending';
end;
$function$;

alter function public.reconcile_plan_join_request(uuid) owner to postgres;
revoke all on function public.reconcile_plan_join_request(uuid) from public, anon, authenticated;

create or replace function public.request_to_join_plan(p_plan_id uuid)
returns table (
  request_id uuid,
  request_state text,
  requested_at timestamptz,
  voting_started_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_plan public.plans%rowtype;
  v_existing public.plan_join_requests%rowtype;
  v_state text;
  v_request public.plan_join_requests%rowtype;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_plan_id is null then
    raise exception 'plan_id_required' using errcode = '22023';
  end if;

  select p.* into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode = 'P0001'; end if;

  if v_plan.admission_mode <> 'group_vote'::public.admission_mode then
    raise exception 'plan_group_vote_admission_not_enabled' using errcode = 'P0001';
  end if;

  if v_plan.state in ('completed'::public.plan_state, 'cancelled'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    raise exception 'plan_admission_window_closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id = v_plan.id and pm.user_id = v_user_id
      and pm.membership_state = 'active'::public.plan_membership_state
  ) then
    raise exception 'already_plan_member' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_plan.id
    and pm.membership_state = 'active'::public.plan_membership_state;

  if v_active_count >= v_plan.capacity then
    raise exception 'plan_at_capacity' using errcode = 'P0001';
  end if;

  select pjr.* into v_existing
  from public.plan_join_requests pjr
  where pjr.plan_id = v_plan.id
    and pjr.requester_user_id = v_user_id
    and pjr.state in ('queued','pending')
  order by pjr.requested_at desc
  limit 1;

  if found then
    return query select v_existing.id, v_existing.state, v_existing.requested_at,
      v_existing.voting_started_at, v_existing.expires_at;
    return;
  end if;

  v_state := case when exists (
    select 1 from public.plan_join_requests
    where plan_id = v_plan.id and state = 'pending'
  ) then 'queued' else 'pending' end;

  insert into public.plan_join_requests (
    plan_id, requester_user_id, state, requested_at,
    voting_started_at, expires_at, created_at, updated_at
  ) values (
    v_plan.id, v_user_id, v_state, v_now,
    case when v_state = 'pending' then v_now else null end,
    case when v_state = 'pending' then v_now + interval '10 minutes' else null end,
    v_now, v_now
  ) returning * into v_request;

  return query select v_request.id, v_request.state, v_request.requested_at,
    v_request.voting_started_at, v_request.expires_at;
end;
$function$;

alter function public.request_to_join_plan(uuid) owner to postgres;
revoke all on function public.request_to_join_plan(uuid) from public, anon;
grant execute on function public.request_to_join_plan(uuid) to authenticated;

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
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_join_vote' using errcode = '22023'; end if;

  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id = p_request_id
  for update;

  if not found then raise exception 'plan_join_request_not_found' using errcode = 'P0001'; end if;
  if v_request.state <> 'pending' then raise exception 'plan_join_request_not_pending' using errcode = 'P0001'; end if;

  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id = v_request.plan_id
      and pm.user_id = v_user_id
      and pm.membership_state = 'active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode = '42501';
  end if;

  if v_request.expires_at <= v_now then
    v_state := public.reconcile_plan_join_request(v_request.id);
  else
    insert into public.plan_join_request_votes(request_id,user_id,vote,voted_at,updated_at)
    values (v_request.id,v_user_id,p_vote,v_now,v_now)
    on conflict (request_id,user_id) do update
    set vote = excluded.vote, voted_at = v_now, updated_at = v_now;

    v_state := public.reconcile_plan_join_request(v_request.id);
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_request.plan_id
    and pm.membership_state = 'active'::public.plan_membership_state;
  v_majority := floor(v_active_count / 2.0)::integer + 1;

  select
    count(*) filter (where vote = 'yes')::integer,
    count(*) filter (where vote = 'no')::integer
  into v_yes,v_no
  from public.plan_join_request_votes
  where request_id = v_request.id;

  return query select v_request.id, v_state, v_yes, v_no, v_majority;
end;
$function$;

alter function public.vote_on_plan_join_request(uuid,text) owner to postgres;
revoke all on function public.vote_on_plan_join_request(uuid,text) from public, anon;
grant execute on function public.vote_on_plan_join_request(uuid,text) to authenticated;

create or replace function public.reconcile_my_plan_join_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_requester uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select plan_id, requester_user_id into v_plan_id, v_requester
  from public.plan_join_requests where id = p_request_id;
  if not found then raise exception 'plan_join_request_not_found' using errcode = 'P0001'; end if;
  if v_requester <> v_user_id and not public.is_active_plan_member(v_plan_id) then
    raise exception 'plan_join_request_not_visible' using errcode = '42501';
  end if;
  return public.reconcile_plan_join_request(p_request_id);
end;
$function$;

alter function public.reconcile_my_plan_join_request(uuid) owner to postgres;
revoke all on function public.reconcile_my_plan_join_request(uuid) from public, anon;
grant execute on function public.reconcile_my_plan_join_request(uuid) to authenticated;

create or replace function public.leave_my_plan(p_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_plan public.plans%rowtype;
  v_membership_id uuid;
  v_conversation_id uuid;
  v_pending_request_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;

  select p.* into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode = 'P0001'; end if;

  if v_plan.state in ('completed'::public.plan_state, 'cancelled'::public.plan_state) then
    raise exception 'plan_departure_not_allowed' using errcode = 'P0001';
  end if;

  select pm.id into v_membership_id
  from public.plan_memberships pm
  where pm.plan_id = v_plan.id and pm.user_id = v_user_id
    and pm.membership_state = 'active'::public.plan_membership_state
  for update;

  if v_membership_id is null then raise exception 'active_plan_membership_not_found' using errcode = 'P0001'; end if;

  update public.plan_memberships
  set membership_state = 'withdrawn', withdrawn_at = v_now,
      locked_member = false, updated_at = v_now
  where id = v_membership_id;

  select c.id into v_conversation_id from public.conversations c where c.plan_id = v_plan.id;
  if v_conversation_id is not null then
    update public.conversation_membership_intervals
    set ended_at = v_now
    where conversation_id = v_conversation_id
      and user_id = v_user_id
      and ended_at is null;
  end if;

  select pjr.id into v_pending_request_id
  from public.plan_join_requests pjr
  where pjr.plan_id = v_plan.id and pjr.state = 'pending'
  limit 1;

  if v_pending_request_id is not null then
    perform public.reconcile_plan_join_request(v_pending_request_id);
  end if;

  return true;
end;
$function$;

alter function public.leave_my_plan(uuid) owner to postgres;
revoke all on function public.leave_my_plan(uuid) from public, anon;
grant execute on function public.leave_my_plan(uuid) to authenticated;

commit;
