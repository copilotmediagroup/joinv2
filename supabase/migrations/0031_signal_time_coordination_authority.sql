begin;

-- ============================================================
-- SIGNAL
-- Migration 0031
-- Authoritative availability-first time coordination
-- ============================================================
-- PostgreSQL owns time-round state, participant eligibility,
-- complete availability submissions, deadline reconciliation,
-- winner selection, and no-eligible-time outcomes.
-- Tie-break order: most available participants, strongest
-- explicit preference, then earliest practical time.
-- ============================================================

create table if not exists public.signal_time_rounds (
  id uuid primary key default gen_random_uuid(),
  signal_group_id uuid not null references public.signal_groups(id) on delete cascade,
  state text not null default 'open',
  opens_at timestamptz not null default clock_timestamp(),
  closes_at timestamptz not null,
  winner_option_id uuid null,
  eligible_participant_count integer not null,
  activation_threshold integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint signal_time_rounds_state_check
    check (state in ('open', 'won', 'no_eligible')),
  constraint signal_time_rounds_window_check
    check (closes_at > opens_at),
  constraint signal_time_rounds_eligible_check
    check (eligible_participant_count >= 0),
  constraint signal_time_rounds_threshold_check
    check (activation_threshold >= 1),
  constraint signal_time_rounds_group_key unique (signal_group_id)
);

create table if not exists public.signal_time_options (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.signal_time_rounds(id) on delete cascade,
  starts_at timestamptz not null,
  label text not null,
  source_rank integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint signal_time_options_label_check
    check (nullif(btrim(label), '') is not null),
  constraint signal_time_options_rank_check check (source_rank >= 1),
  constraint signal_time_options_round_start_key unique (round_id, starts_at),
  constraint signal_time_options_round_id_key unique (round_id, id)
);

alter table public.signal_time_rounds
  drop constraint if exists signal_time_rounds_winner_option_fkey;

alter table public.signal_time_rounds
  add constraint signal_time_rounds_winner_option_fkey
  foreign key (id, winner_option_id)
  references public.signal_time_options(round_id, id)
  deferrable initially deferred;

create table if not exists public.signal_time_availability (
  round_id uuid not null,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  option_id uuid not null,
  available boolean not null,
  is_preferred boolean not null default false,
  submitted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (round_id, user_id, option_id),
  constraint signal_time_availability_option_fkey
    foreign key (round_id, option_id)
    references public.signal_time_options(round_id, id)
    on delete cascade,
  constraint signal_time_preference_requires_available
    check (not is_preferred or available)
);

create index if not exists signal_time_options_round_rank_idx
  on public.signal_time_options(round_id, source_rank);
create index if not exists signal_time_availability_option_idx
  on public.signal_time_availability(round_id, option_id, available);

alter table public.signal_time_rounds enable row level security;
alter table public.signal_time_options enable row level security;
alter table public.signal_time_availability enable row level security;

create or replace function public.is_signal_time_round_member(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.signal_time_rounds str
    where str.id = p_round_id
      and public.is_signal_group_member(str.signal_group_id)
  );
$function$;

alter function public.is_signal_time_round_member(uuid) owner to postgres;
revoke all on function public.is_signal_time_round_member(uuid) from public, anon;
grant execute on function public.is_signal_time_round_member(uuid) to authenticated;

create policy signal_time_rounds_select_member
on public.signal_time_rounds
for select to authenticated
using (public.is_signal_group_member(signal_group_id));

create policy signal_time_options_select_member
on public.signal_time_options
for select to authenticated
using (public.is_signal_time_round_member(round_id));

create policy signal_time_availability_select_member
on public.signal_time_availability
for select to authenticated
using (public.is_signal_time_round_member(round_id));

revoke all on table
  public.signal_time_rounds,
  public.signal_time_options,
  public.signal_time_availability
from anon;

revoke insert, update, delete on table
  public.signal_time_rounds,
  public.signal_time_options,
  public.signal_time_availability
from authenticated;

grant select on table
  public.signal_time_rounds,
  public.signal_time_options,
  public.signal_time_availability
to authenticated;

-- Service-side initialization. Options are generated by trusted
-- Edge logic from the already-won venue snapshot + Signal window.
create or replace function public.ensure_signal_time_round(
  p_signal_group_id uuid,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;
  v_existing uuid;
  v_round_id uuid;
  v_option_count integer;
  v_distinct_count integer;
  v_eligible_count integer;
begin
  if p_signal_group_id is null then
    raise exception 'signal_group_id_required' using errcode = '22023';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'signal_time_options_array_required' using errcode = '22023';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found' using errcode = 'P0001';
  end if;

  if v_group.state not in ('locked'::public.signal_group_state, 'coordinating'::public.signal_group_state) then
    raise exception 'signal_group_not_ready_for_time_coordination: %', v_group.state
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.signal_venue_rounds svr
    where svr.signal_group_id = v_group.id
      and svr.state = 'won'
      and svr.winner_option_id is not null
  ) then
    raise exception 'signal_venue_winner_required' using errcode = 'P0001';
  end if;

  select str.id into v_existing
  from public.signal_time_rounds str
  where str.signal_group_id = v_group.id;

  if v_existing is not null then
    return v_existing;
  end if;

  select count(*), count(distinct nullif(option_row.value->>'startsAt', ''))
  into v_option_count, v_distinct_count
  from jsonb_array_elements(p_options) option_row(value);

  if v_option_count < 1 or v_option_count > 5 then
    raise exception 'signal_time_option_count_invalid: %', v_option_count using errcode = '22023';
  end if;

  if v_distinct_count <> v_option_count then
    raise exception 'signal_time_option_starts_invalid_or_duplicate' using errcode = '22023';
  end if;

  select gp.* into v_policy
  from public.grouping_policies gp
  where gp.id = v_group.grouping_policy_id;

  if not found or v_policy.activation_threshold is null or v_policy.activation_threshold < 1 then
    raise exception 'invalid_signal_activation_threshold' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_eligible_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  if v_eligible_count < v_policy.activation_threshold then
    raise exception 'signal_time_active_core_below_threshold' using errcode = 'P0001';
  end if;

  insert into public.signal_time_rounds (
    signal_group_id, state, opens_at, closes_at,
    eligible_participant_count, activation_threshold
  ) values (
    v_group.id, 'open', clock_timestamp(), clock_timestamp() + interval '5 minutes',
    v_eligible_count, v_policy.activation_threshold
  ) returning id into v_round_id;

  insert into public.signal_time_options (
    round_id, starts_at, label, source_rank, payload
  )
  select
    v_round_id,
    (option_row.value->>'startsAt')::timestamptz,
    coalesce(nullif(btrim(option_row.value->>'label'), ''), 'Meetup time'),
    coalesce((option_row.value->>'sourceRank')::integer, option_row.ordinality::integer),
    option_row.value
  from jsonb_array_elements(p_options) with ordinality as option_row(value, ordinality)
  order by option_row.ordinality;

  return v_round_id;
end;
$function$;

alter function public.ensure_signal_time_round(uuid, jsonb) owner to postgres;
revoke all on function public.ensure_signal_time_round(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_signal_time_round(uuid, jsonb) to service_role;

create or replace function public.reconcile_signal_time_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_group_id uuid;
  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;
  v_round public.signal_time_rounds%rowtype;
  v_eligible_count integer;
  v_option_count integer;
  v_responded_count integer;
  v_winner_option_id uuid;
  v_winner_available_count integer := 0;
begin
  select str.signal_group_id into v_group_id
  from public.signal_time_rounds str
  where str.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_time_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select str.* into v_round
  from public.signal_time_rounds str
  where str.id = p_round_id
  for update;

  if not found then
    raise exception 'signal_time_round_not_found' using errcode = 'P0001';
  end if;

  if v_round.state <> 'open' then
    return;
  end if;

  select gp.* into v_policy
  from public.grouping_policies gp
  where gp.id = v_group.grouping_policy_id;

  if not found or v_policy.activation_threshold is null then
    raise exception 'invalid_signal_activation_threshold' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_eligible_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  update public.signal_time_rounds
  set eligible_participant_count = v_eligible_count,
      activation_threshold = v_policy.activation_threshold,
      updated_at = clock_timestamp()
  where id = v_round.id;

  if v_eligible_count < v_policy.activation_threshold then
    update public.signal_time_rounds
    set state = 'no_eligible', winner_option_id = null, updated_at = clock_timestamp()
    where id = v_round.id and state = 'open';
    return;
  end if;

  select count(*)::integer into v_option_count
  from public.signal_time_options sto
  where sto.round_id = v_round.id;

  select count(distinct sta.user_id)::integer into v_responded_count
  from public.signal_time_availability sta
  where sta.round_id = v_round.id
    and exists (
      select 1
      from public.signal_group_memberships sgm
      where sgm.signal_group_id = v_group.id
        and sgm.user_id = sta.user_id
        and sgm.state = 'confirmed'::public.signal_group_membership_state
        and sgm.is_active_core = true
    );

  if clock_timestamp() < v_round.closes_at
     and v_responded_count < v_eligible_count then
    return;
  end if;

  select ranked.option_id, ranked.available_count
  into v_winner_option_id, v_winner_available_count
  from (
    select
      sto.id as option_id,
      sto.starts_at,
      count(*) filter (
        where sta.available = true
          and exists (
            select 1
            from public.signal_group_memberships sgm
            where sgm.signal_group_id = v_group.id
              and sgm.user_id = sta.user_id
              and sgm.state = 'confirmed'::public.signal_group_membership_state
              and sgm.is_active_core = true
          )
      )::integer as available_count,
      count(*) filter (
        where sta.available = true
          and sta.is_preferred = true
          and exists (
            select 1
            from public.signal_group_memberships sgm
            where sgm.signal_group_id = v_group.id
              and sgm.user_id = sta.user_id
              and sgm.state = 'confirmed'::public.signal_group_membership_state
              and sgm.is_active_core = true
          )
      )::integer as preferred_count
    from public.signal_time_options sto
    left join public.signal_time_availability sta
      on sta.round_id = sto.round_id
     and sta.option_id = sto.id
    where sto.round_id = v_round.id
    group by sto.id, sto.starts_at
    order by available_count desc, preferred_count desc, sto.starts_at asc, sto.id asc
    limit 1
  ) ranked;

  if v_winner_option_id is null
     or v_winner_available_count < v_policy.activation_threshold then
    update public.signal_time_rounds
    set state = 'no_eligible', winner_option_id = null, updated_at = clock_timestamp()
    where id = v_round.id and state = 'open';
    return;
  end if;

  update public.signal_time_rounds
  set state = 'won', winner_option_id = v_winner_option_id, updated_at = clock_timestamp()
  where id = v_round.id and state = 'open';
end;
$function$;

alter function public.reconcile_signal_time_round(uuid) owner to postgres;
revoke all on function public.reconcile_signal_time_round(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_signal_time_round(uuid) to service_role;

create or replace function public.submit_my_signal_time_availability(
  p_round_id uuid,
  p_available_option_ids uuid[],
  p_preferred_option_id uuid default null
)
returns table (
  submission_accepted boolean,
  round_state text,
  winner_option_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_group public.signal_groups%rowtype;
  v_round public.signal_time_rounds%rowtype;
  v_invalid_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_round_id is null or p_available_option_ids is null then
    raise exception 'signal_time_round_and_availability_required' using errcode = '22023';
  end if;

  select str.signal_group_id into v_group_id
  from public.signal_time_rounds str
  where str.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_time_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select str.* into v_round
  from public.signal_time_rounds str
  where str.id = p_round_id
  for update;

  if not exists (
    select 1
    from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_time_submission_not_eligible' using errcode = '42501';
  end if;

  if v_round.state <> 'open' or clock_timestamp() >= v_round.closes_at then
    perform public.reconcile_signal_time_round(v_round.id);
    select state, signal_time_rounds.winner_option_id
    into v_round.state, v_round.winner_option_id
    from public.signal_time_rounds
    where id = v_round.id;
    return query select false, v_round.state, v_round.winner_option_id;
    return;
  end if;

  select count(*)::integer into v_invalid_count
  from unnest(p_available_option_ids) supplied(option_id)
  where not exists (
    select 1 from public.signal_time_options sto
    where sto.round_id = v_round.id and sto.id = supplied.option_id
  );

  if v_invalid_count > 0 then
    raise exception 'signal_time_option_not_in_round' using errcode = '22023';
  end if;

  if p_preferred_option_id is not null
     and not (p_preferred_option_id = any(p_available_option_ids)) then
    raise exception 'signal_time_preferred_option_must_be_available' using errcode = '22023';
  end if;

  insert into public.signal_time_availability (
    round_id, user_id, option_id, available, is_preferred, submitted_at, updated_at
  )
  select
    v_round.id,
    v_user_id,
    sto.id,
    sto.id = any(p_available_option_ids),
    sto.id = p_preferred_option_id,
    clock_timestamp(),
    clock_timestamp()
  from public.signal_time_options sto
  where sto.round_id = v_round.id
  on conflict (round_id, user_id, option_id)
  do update set
    available = excluded.available,
    is_preferred = excluded.is_preferred,
    submitted_at = excluded.submitted_at,
    updated_at = excluded.updated_at;

  perform public.reconcile_signal_time_round(v_round.id);

  select state, signal_time_rounds.winner_option_id
  into v_round.state, v_round.winner_option_id
  from public.signal_time_rounds
  where id = v_round.id;

  return query select true, v_round.state, v_round.winner_option_id;
end;
$function$;

alter function public.submit_my_signal_time_availability(uuid, uuid[], uuid) owner to postgres;
revoke all on function public.submit_my_signal_time_availability(uuid, uuid[], uuid) from public, anon;
grant execute on function public.submit_my_signal_time_availability(uuid, uuid[], uuid) to authenticated;

create or replace function public.reconcile_my_signal_time_round(p_round_id uuid)
returns table (round_state text, winner_option_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select signal_group_id into v_group_id
  from public.signal_time_rounds
  where id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_time_round_not_found' using errcode = 'P0001';
  end if;

  if not public.is_signal_group_member(v_group_id) then
    raise exception 'signal_membership_required' using errcode = '42501';
  end if;

  perform public.reconcile_signal_time_round(p_round_id);

  return query
  select str.state, str.winner_option_id
  from public.signal_time_rounds str
  where str.id = p_round_id;
end;
$function$;

alter function public.reconcile_my_signal_time_round(uuid) owner to postgres;
revoke all on function public.reconcile_my_signal_time_round(uuid) from public, anon;
grant execute on function public.reconcile_my_signal_time_round(uuid) to authenticated;

-- Publish authoritative time coordination tables for Realtime invalidation.
do $publication$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_time_rounds'
  ) then
    alter publication supabase_realtime add table public.signal_time_rounds;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_time_options'
  ) then
    alter publication supabase_realtime add table public.signal_time_options;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_time_availability'
  ) then
    alter publication supabase_realtime add table public.signal_time_availability;
  end if;
end
$publication$;

commit;
