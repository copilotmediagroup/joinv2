begin;

-- ============================================================
-- SIGNAL
-- Migration 0030
-- Authoritative venue voting + runoff foundation
-- ============================================================
-- PostgreSQL owns round state, eligibility, vote mutation,
-- majority resolution, deadlines, and runoff creation.
-- Browser clients receive read-only table access and mutate only
-- through auth.uid()-scoped RPCs. Google place payloads are
-- snapshotted once so every member votes on the same options.
-- ============================================================

create table if not exists public.signal_venue_rounds (
  id uuid primary key default gen_random_uuid(),
  signal_group_id uuid not null references public.signal_groups(id) on delete cascade,
  round_number smallint not null,
  round_kind text not null,
  state text not null default 'open',
  opens_at timestamptz not null default clock_timestamp(),
  closes_at timestamptz not null,
  winner_option_id uuid null,
  eligible_voter_count integer not null,
  majority_required integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint signal_venue_rounds_number_check check (round_number in (1, 2)),
  constraint signal_venue_rounds_kind_check check (round_kind in ('initial', 'runoff')),
  constraint signal_venue_rounds_state_check check (state in ('open', 'won', 'runoff', 'deadlocked')),
  constraint signal_venue_rounds_window_check check (closes_at > opens_at),
  constraint signal_venue_rounds_voter_count_check check (eligible_voter_count >= 1),
  constraint signal_venue_rounds_majority_check check (majority_required >= 1),
  constraint signal_venue_rounds_group_number_key unique (signal_group_id, round_number)
);

create table if not exists public.signal_venue_options (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.signal_venue_rounds(id) on delete cascade,
  place_id text not null,
  name text not null,
  source_rank integer not null,
  signal_score numeric null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint signal_venue_options_place_check check (nullif(btrim(place_id), '') is not null),
  constraint signal_venue_options_name_check check (nullif(btrim(name), '') is not null),
  constraint signal_venue_options_rank_check check (source_rank >= 1),
  constraint signal_venue_options_round_place_key unique (round_id, place_id),
  constraint signal_venue_options_round_id_key unique (round_id, id)
);

alter table public.signal_venue_rounds
  drop constraint if exists signal_venue_rounds_winner_option_fkey;

alter table public.signal_venue_rounds
  add constraint signal_venue_rounds_winner_option_fkey
  foreign key (id, winner_option_id)
  references public.signal_venue_options(round_id, id)
  deferrable initially deferred;

create table if not exists public.signal_venue_votes (
  round_id uuid not null,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  option_id uuid not null,
  cast_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (round_id, user_id),
  constraint signal_venue_votes_option_fkey
    foreign key (round_id, option_id)
    references public.signal_venue_options(round_id, id)
    on delete cascade
);

create index if not exists signal_venue_rounds_group_state_idx
  on public.signal_venue_rounds(signal_group_id, state, round_number desc);

create index if not exists signal_venue_votes_option_idx
  on public.signal_venue_votes(round_id, option_id);

alter table public.signal_venue_rounds enable row level security;
alter table public.signal_venue_options enable row level security;
alter table public.signal_venue_votes enable row level security;

create or replace function public.is_signal_venue_round_member(
  p_round_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.signal_venue_rounds svr
    where svr.id = p_round_id
      and public.is_signal_group_member(svr.signal_group_id)
  );
$function$;

alter function public.is_signal_venue_round_member(uuid) owner to postgres;
revoke all on function public.is_signal_venue_round_member(uuid) from public, anon;
grant execute on function public.is_signal_venue_round_member(uuid) to authenticated;

create policy signal_venue_rounds_select_member
on public.signal_venue_rounds
for select to authenticated
using (public.is_signal_group_member(signal_group_id));

create policy signal_venue_options_select_member
on public.signal_venue_options
for select to authenticated
using (public.is_signal_venue_round_member(round_id));

create policy signal_venue_votes_select_member
on public.signal_venue_votes
for select to authenticated
using (public.is_signal_venue_round_member(round_id));

revoke all on table
  public.signal_venue_rounds,
  public.signal_venue_options,
  public.signal_venue_votes
from anon;

revoke insert, update, delete on table
  public.signal_venue_rounds,
  public.signal_venue_options,
  public.signal_venue_votes
from authenticated;

grant select on table
  public.signal_venue_rounds,
  public.signal_venue_options,
  public.signal_venue_votes
to authenticated;

-- ============================================================
-- Service-side round initialization.
-- The edge function supplies ranked Google snapshots. The first
-- successful caller wins initialization; later callers reuse it.
-- ============================================================
create or replace function public.ensure_signal_venue_round(
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
  v_existing_round_id uuid;
  v_round_id uuid;
  v_option_count integer;
  v_distinct_place_count integer;
  v_eligible_count integer;
begin
  if p_signal_group_id is null then
    raise exception 'signal_group_id_required' using errcode = '22023';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'signal_venue_options_array_required' using errcode = '22023';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found' using errcode = 'P0001';
  end if;

  if v_group.state not in ('locked'::public.signal_group_state, 'coordinating'::public.signal_group_state) then
    raise exception 'signal_group_not_ready_for_venue_vote: %', v_group.state using errcode = 'P0001';
  end if;

  select svr.id into v_existing_round_id
  from public.signal_venue_rounds svr
  where svr.signal_group_id = v_group.id
  order by svr.round_number desc
  limit 1;

  if v_existing_round_id is not null then
    return v_existing_round_id;
  end if;

  select count(*), count(distinct nullif(btrim(option_row.value->>'placeId'), ''))
  into v_option_count, v_distinct_place_count
  from jsonb_array_elements(p_options) option_row(value);

  if v_option_count < 2 or v_option_count > 5 then
    raise exception 'signal_venue_option_count_invalid: %', v_option_count using errcode = '22023';
  end if;

  if v_distinct_place_count <> v_option_count then
    raise exception 'signal_venue_place_ids_invalid_or_duplicate' using errcode = '22023';
  end if;

  select count(*)::integer into v_eligible_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  if v_eligible_count < 1 then
    raise exception 'signal_venue_no_eligible_voters' using errcode = 'P0001';
  end if;

  insert into public.signal_venue_rounds (
    signal_group_id, round_number, round_kind, state,
    opens_at, closes_at, eligible_voter_count, majority_required
  ) values (
    v_group.id, 1, 'initial', 'open',
    clock_timestamp(), clock_timestamp() + interval '10 minutes',
    v_eligible_count, floor(v_eligible_count / 2.0)::integer + 1
  ) returning id into v_round_id;

  insert into public.signal_venue_options (
    round_id, place_id, name, source_rank, signal_score, payload
  )
  select
    v_round_id,
    btrim(option_row.value->>'placeId'),
    coalesce(nullif(btrim(option_row.value->>'name'), ''), 'Unknown place'),
    coalesce((option_row.value->>'signalRank')::integer, option_row.ordinality::integer),
    nullif(option_row.value->>'signalScore', '')::numeric,
    option_row.value
  from jsonb_array_elements(p_options) with ordinality as option_row(value, ordinality);

  return v_round_id;
end;
$function$;

alter function public.ensure_signal_venue_round(uuid, jsonb) owner to postgres;
revoke all on function public.ensure_signal_venue_round(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_signal_venue_round(uuid, jsonb) to service_role;

-- ============================================================
-- Internal reconciliation.
-- Canonical lock order: group -> round -> vote-derived decision.
-- Initial round: strict majority wins immediately. At deadline,
-- lack of majority advances the top two to a five-minute runoff.
-- Runoff: strict majority wins; unresolved deadline becomes
-- deadlocked rather than inventing a winner.
-- ============================================================
create or replace function public.reconcile_signal_venue_round(
  p_round_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_group_id uuid;
  v_group public.signal_groups%rowtype;
  v_round public.signal_venue_rounds%rowtype;
  v_eligible_count integer;
  v_majority integer;
  v_top_option_id uuid;
  v_top_votes integer := 0;
  v_second_option_id uuid;
  v_runoff_id uuid;
begin
  select svr.signal_group_id into v_group_id
  from public.signal_venue_rounds svr
  where svr.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_venue_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select svr.* into v_round
  from public.signal_venue_rounds svr
  where svr.id = p_round_id
  for update;

  if not found then
    raise exception 'signal_venue_round_not_found' using errcode = 'P0001';
  end if;

  if v_round.state <> 'open' then
    return;
  end if;

  select count(*)::integer into v_eligible_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  if v_eligible_count < 1 then
    update public.signal_venue_rounds
    set state = 'deadlocked', updated_at = clock_timestamp()
    where id = v_round.id;
    return;
  end if;

  v_majority := floor(v_eligible_count / 2.0)::integer + 1;

  update public.signal_venue_rounds
  set eligible_voter_count = v_eligible_count,
      majority_required = v_majority,
      updated_at = clock_timestamp()
  where id = v_round.id;

  select scored.option_id, scored.vote_count
  into v_top_option_id, v_top_votes
  from (
    select svo.id as option_id,
           count(svv.user_id)::integer as vote_count,
           svo.source_rank
    from public.signal_venue_options svo
    left join public.signal_venue_votes svv
      on svv.round_id = svo.round_id
     and svv.option_id = svo.id
     and exists (
       select 1
       from public.signal_group_memberships sgm
       where sgm.signal_group_id = v_group.id
         and sgm.user_id = svv.user_id
         and sgm.state = 'confirmed'::public.signal_group_membership_state
         and sgm.is_active_core = true
     )
    where svo.round_id = v_round.id
    group by svo.id, svo.source_rank
    order by vote_count desc, svo.source_rank asc, svo.id asc
    limit 1
  ) scored;

  if v_top_option_id is not null and v_top_votes >= v_majority then
    update public.signal_venue_rounds
    set state = 'won',
        winner_option_id = v_top_option_id,
        updated_at = clock_timestamp()
    where id = v_round.id;
    return;
  end if;

  if clock_timestamp() < v_round.closes_at then
    return;
  end if;

  if v_round.round_kind = 'initial' then
    select ranked.option_id into v_top_option_id
    from (
      select svo.id as option_id,
             count(svv.user_id)::integer as vote_count,
             svo.source_rank
      from public.signal_venue_options svo
      left join public.signal_venue_votes svv
        on svv.round_id = svo.round_id and svv.option_id = svo.id
      where svo.round_id = v_round.id
      group by svo.id, svo.source_rank
      order by vote_count desc, svo.source_rank asc, svo.id asc
      limit 1
    ) ranked;

    select ranked.option_id into v_second_option_id
    from (
      select svo.id as option_id,
             count(svv.user_id)::integer as vote_count,
             svo.source_rank
      from public.signal_venue_options svo
      left join public.signal_venue_votes svv
        on svv.round_id = svo.round_id and svv.option_id = svo.id
      where svo.round_id = v_round.id
      group by svo.id, svo.source_rank
      order by vote_count desc, svo.source_rank asc, svo.id asc
      offset 1 limit 1
    ) ranked;

    if v_top_option_id is null or v_second_option_id is null then
      update public.signal_venue_rounds
      set state = 'deadlocked', updated_at = clock_timestamp()
      where id = v_round.id;
      return;
    end if;

    insert into public.signal_venue_rounds (
      signal_group_id, round_number, round_kind, state,
      opens_at, closes_at, eligible_voter_count, majority_required
    ) values (
      v_group.id, 2, 'runoff', 'open',
      clock_timestamp(), clock_timestamp() + interval '5 minutes',
      v_eligible_count, v_majority
    )
    on conflict (signal_group_id, round_number) do nothing
    returning id into v_runoff_id;

    if v_runoff_id is null then
      select id into v_runoff_id
      from public.signal_venue_rounds
      where signal_group_id = v_group.id and round_number = 2;
    end if;

    insert into public.signal_venue_options (
      round_id, place_id, name, source_rank, signal_score, payload
    )
    select v_runoff_id, svo.place_id, svo.name, svo.source_rank, svo.signal_score, svo.payload
    from public.signal_venue_options svo
    where svo.round_id = v_round.id
      and svo.id in (v_top_option_id, v_second_option_id)
    on conflict (round_id, place_id) do nothing;

    update public.signal_venue_rounds
    set state = 'runoff', updated_at = clock_timestamp()
    where id = v_round.id and state = 'open';
    return;
  end if;

  update public.signal_venue_rounds
  set state = 'deadlocked', updated_at = clock_timestamp()
  where id = v_round.id and state = 'open';
end;
$function$;

alter function public.reconcile_signal_venue_round(uuid) owner to postgres;
revoke all on function public.reconcile_signal_venue_round(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_signal_venue_round(uuid) to service_role;

-- ============================================================
-- Authenticated vote authority.
-- One vote per member per round; repeat calls change that vote.
-- ============================================================
create or replace function public.cast_my_signal_venue_vote(
  p_round_id uuid,
  p_option_id uuid
)
returns table (
  vote_accepted boolean,
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
  v_round public.signal_venue_rounds%rowtype;
  v_option_exists boolean;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_round_id is null or p_option_id is null then
    raise exception 'signal_venue_round_and_option_required' using errcode = '22023';
  end if;

  select svr.signal_group_id into v_group_id
  from public.signal_venue_rounds svr
  where svr.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_venue_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select svr.* into v_round
  from public.signal_venue_rounds svr
  where svr.id = p_round_id
  for update;

  if not exists (
    select 1 from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_venue_vote_not_eligible' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.signal_venue_options svo
    where svo.round_id = v_round.id and svo.id = p_option_id
  ) into v_option_exists;

  if not v_option_exists then
    raise exception 'signal_venue_option_not_in_round' using errcode = '22023';
  end if;

  if v_round.state <> 'open' or clock_timestamp() >= v_round.closes_at then
    perform public.reconcile_signal_venue_round(v_round.id);
    select state, signal_venue_rounds.winner_option_id
    into v_round.state, v_round.winner_option_id
    from public.signal_venue_rounds
    where id = v_round.id;

    return query select false, v_round.state, v_round.winner_option_id;
    return;
  end if;

  insert into public.signal_venue_votes (round_id, user_id, option_id, cast_at, updated_at)
  values (v_round.id, v_user_id, p_option_id, clock_timestamp(), clock_timestamp())
  on conflict (round_id, user_id)
  do update set option_id = excluded.option_id, updated_at = excluded.updated_at;

  perform public.reconcile_signal_venue_round(v_round.id);

  select state, signal_venue_rounds.winner_option_id
  into v_round.state, v_round.winner_option_id
  from public.signal_venue_rounds
  where id = v_round.id;

  return query select true, v_round.state, v_round.winner_option_id;
end;
$function$;

alter function public.cast_my_signal_venue_vote(uuid, uuid) owner to postgres;
revoke all on function public.cast_my_signal_venue_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_my_signal_venue_vote(uuid, uuid) to authenticated;

create or replace function public.reconcile_my_signal_venue_round(
  p_round_id uuid
)
returns table (
  round_state text,
  winner_option_id uuid
)
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
  from public.signal_venue_rounds
  where id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_venue_round_not_found' using errcode = 'P0001';
  end if;

  if not public.is_signal_group_member(v_group_id) then
    raise exception 'signal_membership_required' using errcode = '42501';
  end if;

  perform public.reconcile_signal_venue_round(p_round_id);

  return query
  select svr.state, svr.winner_option_id
  from public.signal_venue_rounds svr
  where svr.id = p_round_id;
end;
$function$;

alter function public.reconcile_my_signal_venue_round(uuid) owner to postgres;
revoke all on function public.reconcile_my_signal_venue_round(uuid) from public, anon;
grant execute on function public.reconcile_my_signal_venue_round(uuid) to authenticated;

-- Publish decision tables for invalidation-driven Realtime refresh.
do $publication$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_venue_rounds'
  ) then
    alter publication supabase_realtime add table public.signal_venue_rounds;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_venue_options'
  ) then
    alter publication supabase_realtime add table public.signal_venue_options;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'signal_venue_votes'
  ) then
    alter publication supabase_realtime add table public.signal_venue_votes;
  end if;
end
$publication$;

commit;
