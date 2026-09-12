begin;

-- ============================================================
-- SIGNAL
-- 0012_authenticated_onboarding_authority.sql
--
-- Purpose:
--   Establish the authoritative authenticated onboarding contract.
--
-- Authority:
--   auth.uid()
--     -> public.user_profiles
--     -> canonical active public.cities
--     -> canonical active public.states
--
-- Security:
--   - caller cannot choose another user_id
--   - caller cannot directly mark an incomplete profile complete
--   - home city must be canonical and active
--   - state must be active
--   - birth date is validated server-side
--   - gender uses the database enum
--   - profile completion remains PostgreSQL-owned
--   - raw user_profiles table access is not granted here
--
-- Avatar storage is intentionally NOT created in this migration.
-- Storage receives its own migration/gate.
-- ============================================================


-- ============================================================
-- READ CURRENT AUTHENTICATED ONBOARDING STATE
-- ============================================================

create or replace function public.get_my_onboarding_state()
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  birth_date date,
  gender public.profile_gender,
  home_city_id uuid,
  city_name text,
  city_slug text,
  state_code text,
  state_name text,
  completion_state public.profile_completion_state
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    up.user_id,
    up.display_name,
    up.avatar_path,
    up.birth_date,
    up.gender,
    up.home_city_id,
    c.name as city_name,
    c.slug as city_slug,
    s.code as state_code,
    s.name as state_name,
    up.completion_state
  from public.user_profiles up
  left join public.cities c
    on c.id = up.home_city_id
  left join public.states s
    on s.id = c.state_id
  where up.user_id = auth.uid();
$$;

alter function public.get_my_onboarding_state()
  owner to postgres;

revoke all
on function public.get_my_onboarding_state()
from public;

revoke all
on function public.get_my_onboarding_state()
from anon;

grant execute
on function public.get_my_onboarding_state()
to authenticated;


-- ============================================================
-- AUTHORITATIVE PROFILE COMPLETION
-- ============================================================

create or replace function public.complete_my_onboarding(
  p_display_name text,
  p_avatar_path text,
  p_birth_date date,
  p_gender public.profile_gender,
  p_home_city_id uuid
)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  birth_date date,
  gender public.profile_gender,
  home_city_id uuid,
  city_name text,
  city_slug text,
  state_code text,
  state_name text,
  completion_state public.profile_completion_state
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_path text;
  v_city public.cities%rowtype;
  v_state public.states%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception
      using
        errcode = '28000',
        message = 'Authentication required';
  end if;

  v_display_name := nullif(btrim(p_display_name), '');
  v_avatar_path := nullif(btrim(p_avatar_path), '');

  if v_display_name is null then
    raise exception
      using
        errcode = '22023',
        message = 'Display name is required';
  end if;

  if char_length(v_display_name) > 80 then
    raise exception
      using
        errcode = '22023',
        message = 'Display name is too long';
  end if;

  if v_avatar_path is null then
    raise exception
      using
        errcode = '22023',
        message = 'Profile photo is required';
  end if;

  if p_birth_date is null then
    raise exception
      using
        errcode = '22023',
        message = 'Birth date is required';
  end if;

  if p_birth_date > current_date then
    raise exception
      using
        errcode = '22023',
        message = 'Birth date cannot be in the future';
  end if;

  if p_gender is null then
    raise exception
      using
        errcode = '22023',
        message = 'Gender is required';
  end if;

  if p_home_city_id is null then
    raise exception
      using
        errcode = '22023',
        message = 'Home city is required';
  end if;

  select c.*
  into v_city
  from public.cities c
  where c.id = p_home_city_id
    and c.is_active = true;

  if not found then
    raise exception
      using
        errcode = '22023',
        message = 'Home city is invalid or inactive';
  end if;

  select s.*
  into v_state
  from public.states s
  where s.id = v_city.state_id
    and s.is_active = true;

  if not found then
    raise exception
      using
        errcode = '22023',
        message = 'Home state is invalid or inactive';
  end if;

  update public.user_profiles up
  set
    display_name = v_display_name,
    avatar_path = v_avatar_path,
    birth_date = p_birth_date,
    gender = p_gender,
    home_city_id = v_city.id,
    completion_state = 'complete',
    updated_at = now()
  where up.user_id = v_user_id;

  if not found then
    raise exception
      using
        errcode = 'P0002',
        message = 'Authenticated profile does not exist';
  end if;

  return query
  select
    up.user_id,
    up.display_name,
    up.avatar_path,
    up.birth_date,
    up.gender,
    up.home_city_id,
    c.name,
    c.slug,
    s.code,
    s.name,
    up.completion_state
  from public.user_profiles up
  join public.cities c
    on c.id = up.home_city_id
  join public.states s
    on s.id = c.state_id
  where up.user_id = v_user_id;
end;
$$;

alter function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
owner to postgres;

revoke all
on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
from public;

revoke all
on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
from anon;

grant execute
on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
to authenticated;


comment on function public.get_my_onboarding_state() is
'Returns only the authenticated user''s onboarding/profile state using auth.uid().';

comment on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
) is
'Completes onboarding for auth.uid() only after validating required profile fields and canonical active home-city/state authority.';


commit;
