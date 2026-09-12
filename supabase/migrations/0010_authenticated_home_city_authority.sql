begin;

-- ============================================================
-- SIGNAL
-- Migration 0010
-- Authenticated home-city authority RPC
-- ============================================================
--
-- Purpose:
--   Give the browser one narrow, read-only authority seam for
--   resolving the signed-in user's canonical home city.
--
-- Security contract:
--   - caller supplies no user UUID
--   - caller supplies no city UUID or slug
--   - identity comes only from auth.uid()
--   - user_profiles remains protected by RLS
--   - no broad browser SELECT policy is added to user_profiles
--   - SECURITY DEFINER is narrowly scoped to this read
--   - fixed search_path
--   - anon receives no execution authority
--   - authenticated is the only browser role granted execute
-- ============================================================

create or replace function public.get_my_authoritative_home_city()
returns table (
  id uuid,
  name text,
  slug text,
  state_id uuid,
  state_code text,
  state_name text,
  timezone_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_city_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  select up.home_city_id
  into v_home_city_id
  from public.user_profiles up
  where up.user_id = v_user_id;

  if not found then
    raise exception 'user_profile_not_found';
  end if;

  if v_home_city_id is null then
    raise exception 'user_home_city_required';
  end if;

  return query
  select
    c.id,
    c.name,
    c.slug,
    s.id as state_id,
    s.code as state_code,
    s.name as state_name,
    c.timezone_name
  from public.cities c
  join public.states s
    on s.id = c.state_id
  where c.id = v_home_city_id
    and c.is_active = true
    and s.is_active = true;

  if not found then
    raise exception 'authoritative_home_city_not_active';
  end if;
end;
$$;

alter function public.get_my_authoritative_home_city()
  owner to postgres;

revoke all
on function public.get_my_authoritative_home_city()
from public;

revoke all
on function public.get_my_authoritative_home_city()
from anon;

grant execute
on function public.get_my_authoritative_home_city()
to authenticated;

comment on function public.get_my_authoritative_home_city()
is
'Returns the signed-in user''s active canonical home city using auth.uid() only. SECURITY DEFINER permits this narrow read without granting browser SELECT access to user_profiles.';

commit;
