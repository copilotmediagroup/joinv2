-- Deterministic rollback-only fixture for Signal formation contention testing.
-- This file is intentionally NOT a production migration.
-- A future runner opens one database session per fixture user and calls
-- resolve_and_form_signal concurrently, then executes the assertions below.
begin;

create temporary table signal_load_test_results (
  user_id uuid primary key,
  hard_key text not null,
  signal_intent_id uuid,
  signal_group_id uuid,
  elapsed_ms numeric not null,
  error_text text
) on commit drop;

-- Runner timing contract:
-- v_started_at := clock_timestamp();
-- call public.resolve_and_form_signal(...);
-- elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

-- Fixture users must use a reserved signal_load_test_ identity marker and
-- dedicated city/activity fixtures so production journeys cannot be touched.
-- signal_load_test_same_key: all sessions share one hard match key.
-- signal_load_test_distributed: sessions spread across independent hard keys.

-- Invariant 1: no user may finish with more than one assigned intent.
with assigned_count as (
  select user_id,count(*) as assigned_count
  from public.signal_intents
  where state='assigned'
  group by user_id
)
select 1 / case when coalesce(max(assigned_count),0) <= 1 then 1 else 0 end
from assigned_count
where user_id in (select user_id from signal_load_test_results);

-- Invariant 2: no group may exceed its policy max_capacity.
with member_count as (
  select sgm.signal_group_id,count(*) as member_count
  from public.signal_group_memberships sgm
  where sgm.state in ('matched','confirmed')
  group by sgm.signal_group_id
)
select 1 / case when count(*)=0 then 1 else 0 end
from public.signal_groups sg
join public.grouping_policies gp on gp.id=sg.grouping_policy_id
join member_count mc on mc.signal_group_id=sg.id
where sg.id in (select signal_group_id from signal_load_test_results)
  and mc.member_count > gp.max_capacity;

-- Invariant 3: a result may not cross into another hard-match identity.
with crossed_user as (
  select r.user_id,r.hard_key,r.signal_group_id
  from signal_load_test_results r
  join signal_load_test_results peer on peer.signal_group_id=r.signal_group_id
  where peer.hard_key<>r.hard_key
)
select 1 / case when count(*)=0 then 1 else 0 end from crossed_user;

-- Invariant 4: retries for one fixture user must resolve to one assignment.
select 1 / case when count(*)=count(distinct user_id) then 1 else 0 end
from signal_load_test_results
where error_text is null;

-- Report contract for the external concurrent runner:
-- throughput, success/failure count, p50/p95/p99/max elapsed_ms,
-- group count, min/max member_count, duplicate assignment count,
-- crossed_user count and capacity violations.
-- Run at 10 -> 25 -> 50 -> 100 sessions before any larger load.
-- Never point the destructive fixture generator at production identities.

rollback;
