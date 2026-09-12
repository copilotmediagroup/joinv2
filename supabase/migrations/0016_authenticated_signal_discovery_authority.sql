begin;

-- ============================================================
-- SIGNAL
-- Migration 0016
-- Authenticated Signal discovery authority
-- ============================================================
--
-- Purpose:
--   Replace fabricated discovery-card social proof with a narrow,
--   PostgreSQL-owned read contract.
--
-- Authority:
--
--   authenticated browser
--       -> get_my_signal_discovery()
--       -> auth.uid()
--       -> completed user_profiles row
--       -> active canonical home city/state
--       -> active, unexpired Signal intents in that city
--       -> safe activity aggregates + avatar object paths
--
-- Important:
--
--   - caller cannot provide a user UUID
--   - caller cannot provide a city UUID
--   - caller cannot choose arbitrary cities
--   - user_profiles remains protected
--   - signal_intents remains protected by existing RLS
--   - signal_groups/member RLS is not widened
--   - PostgreSQL defines "active"
--   - at most four avatar paths are exposed per activity
--   - only completed profiles may appear in avatar previews
--
-- "active_count" means:
--
--   distinct users whose Signal intent:
--     * belongs to the signed-in user's authoritative home city
--     * has state = active
--     * has not expired
--
-- This represents live expressed intent, including users who may
-- still be waiting for critical mass and have not yet entered a
-- Signal group.
-- ============================================================


create or replace function public.get_my_signal_discovery()
returns table (
  activity_id uuid,
  activity_slug text,
  activity_name text,
  active_count integer,
  preview_avatar_paths text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with authoritative_user as (
    select
      up.user_id,
      up.home_city_id
    from public.user_profiles up
    join public.cities c
      on c.id = up.home_city_id
    join public.states s
      on s.id = c.state_id
    where
      up.user_id = auth.uid()
      and up.completion_state = 'complete'
      and c.is_active = true
      and s.is_active = true
  ),

  active_intents as (
    select
      si.activity_id,
      si.user_id,
      si.created_at,
      up.avatar_path
    from public.signal_intents si
    join authoritative_user au
      on au.home_city_id = si.city_id
    join public.user_profiles up
      on up.user_id = si.user_id
    where
      si.state = 'active'
      and si.expires_at > now()
      and up.completion_state = 'complete'
  ),

  activity_counts as (
    select
      ai.activity_id,
      count(distinct ai.user_id)::integer as active_count
    from active_intents ai
    group by ai.activity_id
  ),

  ranked_avatar_candidates as (
    select
      ai.activity_id,
      ai.user_id,
      ai.avatar_path,
      ai.created_at,
      row_number() over (
        partition by ai.activity_id, ai.user_id
        order by ai.created_at desc
      ) as user_activity_rank
    from active_intents ai
    where
      ai.avatar_path is not null
      and nullif(btrim(ai.avatar_path), '') is not null
  ),

  preview_candidates as (
    select
      rac.activity_id,
      rac.avatar_path,
      rac.created_at,
      row_number() over (
        partition by rac.activity_id
        order by rac.created_at desc, rac.user_id
      ) as preview_rank
    from ranked_avatar_candidates rac
    where rac.user_activity_rank = 1
  ),

  activity_previews as (
    select
      pc.activity_id,
      array_agg(
        pc.avatar_path
        order by pc.preview_rank
      ) as preview_avatar_paths
    from preview_candidates pc
    where pc.preview_rank <= 4
    group by pc.activity_id
  )

  select
    a.id as activity_id,
    a.slug as activity_slug,
    a.name as activity_name,
    coalesce(ac.active_count, 0)::integer as active_count,
    coalesce(
      ap.preview_avatar_paths,
      array[]::text[]
    ) as preview_avatar_paths
  from authoritative_user au
  cross join public.activities a
  left join activity_counts ac
    on ac.activity_id = a.id
  left join activity_previews ap
    on ap.activity_id = a.id
  where
    a.is_active = true
  order by
    a.name,
    a.id;
$$;


alter function public.get_my_signal_discovery()
  owner to postgres;


revoke all
on function public.get_my_signal_discovery()
from public;


revoke all
on function public.get_my_signal_discovery()
from anon;


grant execute
on function public.get_my_signal_discovery()
to authenticated;


comment on function public.get_my_signal_discovery()
is
'Returns safe discovery-card activity social proof for auth.uid()''s authoritative active home city. PostgreSQL defines active users as distinct completed-profile users with active, unexpired Signal intents. Returns counts and at most four avatar object paths per activity without widening Signal or user-profile RLS.';


commit;
