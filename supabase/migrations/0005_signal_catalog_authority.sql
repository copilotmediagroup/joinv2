begin;

-- ============================================================
-- SIGNAL / joinv2
-- 0005_signal_catalog_authority.sql
--
-- Purpose:
--   1. Make city timezone an explicit catalog-owned authority.
--   2. Make activity minimum age an explicit catalog-owned
--      authority.
--   3. Reconcile catalog RLS/read access into committed schema.
--
-- Important:
--   - This migration does NOT invent catalog values.
--   - Existing rows remain nullable until an explicit data gate
--     assigns verified timezone/minimum-age values.
--   - Formation behavior is NOT changed in this migration.
--   - Browser clients receive read-only access to active catalog
--     rows only.
--   - No browser mutation authority is granted.
-- ============================================================


-- ============================================================
-- 1. CITY TIMEZONE AUTHORITY
-- ============================================================

alter table public.cities
  add column if not exists timezone_name text;


-- PostgreSQL's timezone catalog is authoritative for whether a
-- timezone identifier is recognized by the database.
create or replace function public.is_valid_timezone_name(
  p_timezone_name text
)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select
    exists (
      select 1
      from pg_catalog.pg_timezone_names tz
      where tz.name = p_timezone_name
    );
$$;

comment on function public.is_valid_timezone_name(text) is
  'Returns true only when PostgreSQL recognizes the supplied timezone name.';

alter table public.cities
  drop constraint if exists cities_timezone_name_check;

alter table public.cities
  add constraint cities_timezone_name_check
  check (
    timezone_name is null
    or public.is_valid_timezone_name(timezone_name)
  );

comment on column public.cities.timezone_name is
  'Authoritative IANA/PostgreSQL timezone identifier for Signal time-window resolution.';


-- ============================================================
-- 2. ACTIVITY MINIMUM-AGE AUTHORITY
-- ============================================================

alter table public.activities
  add column if not exists minimum_age integer;

alter table public.activities
  drop constraint if exists activities_minimum_age_check;

alter table public.activities
  add constraint activities_minimum_age_check
  check (
    minimum_age is null
    or minimum_age >= 18
  );

comment on column public.activities.minimum_age is
  'Authoritative activity-level minimum age. NULL means no activity-specific minimum beyond platform eligibility.';


-- ============================================================
-- 3. CATALOG RLS CONTRACT
-- ============================================================

alter table public.states
  enable row level security;

alter table public.cities
  enable row level security;

alter table public.activities
  enable row level security;

alter table public.vibes
  enable row level security;

alter table public.grouping_policies
  enable row level security;


-- ============================================================
-- 4. ACTIVE STATES
-- ============================================================

drop policy if exists
  states_select_active
on public.states;

create policy
  states_select_active
on public.states
for select
to authenticated
using (
  is_active = true
);


-- ============================================================
-- 5. ACTIVE CITIES
-- ============================================================

drop policy if exists
  cities_select_active
on public.cities;

create policy
  cities_select_active
on public.cities
for select
to authenticated
using (
  is_active = true
);


-- ============================================================
-- 6. ACTIVE ACTIVITIES
-- ============================================================

drop policy if exists
  activities_select_active
on public.activities;

create policy
  activities_select_active
on public.activities
for select
to authenticated
using (
  is_active = true
);


-- ============================================================
-- 7. ACTIVE VIBES
-- ============================================================

drop policy if exists
  vibes_select_active
on public.vibes;

create policy
  vibes_select_active
on public.vibes
for select
to authenticated
using (
  is_active = true
);


-- ============================================================
-- 8. ACTIVE GROUPING POLICIES
-- ============================================================

drop policy if exists
  grouping_policies_select_active
on public.grouping_policies;

create policy
  grouping_policies_select_active
on public.grouping_policies
for select
to authenticated
using (
  is_active = true
);


-- ============================================================
-- 9. READ PRIVILEGE CONTRACT
--
-- Remove the existing broad browser SELECT grants first.
-- Re-grant only columns the authenticated Signal client may
-- consume.
-- ============================================================

revoke select
on table
  public.states,
  public.cities,
  public.activities,
  public.vibes,
  public.grouping_policies
from anon;

revoke select
on table
  public.states,
  public.cities,
  public.activities,
  public.vibes,
  public.grouping_policies
from authenticated;


grant select (
  id,
  code,
  name,
  is_active
)
on public.states
to authenticated;


grant select (
  id,
  state_id,
  name,
  slug,
  latitude,
  longitude,
  timezone_name,
  is_active
)
on public.cities
to authenticated;


grant select (
  id,
  category_id,
  name,
  slug,
  default_min_group,
  default_target_group,
  default_max_group,
  minimum_age,
  is_active
)
on public.activities
to authenticated;


grant select (
  id,
  name,
  slug,
  is_active
)
on public.vibes
to authenticated;


grant select (
  id,
  code,
  version,
  activation_threshold,
  target_capacity,
  max_capacity,
  is_active
)
on public.grouping_policies
to authenticated;


-- ============================================================
-- 10. NO BROWSER WRITE AUTHORITY
--
-- RLS contains SELECT policies only. No INSERT, UPDATE, or DELETE
-- policies are created by this migration.
-- ============================================================

commit;
