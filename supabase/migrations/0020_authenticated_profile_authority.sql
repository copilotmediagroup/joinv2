begin;

-- ============================================================
-- SIGNAL
-- 0020_authenticated_profile_authority.sql
--
-- Purpose:
--   Establish dedicated authenticated profile read/update
--   authority separate from onboarding.
--
-- Authority:
--   auth.uid()
--     -> public.user_profiles
--
-- V1 editable profile fields:
--   - display_name
--   - avatar_path
--   - bio
--
-- Deliberately NOT editable through this contract:
--   - user_id
--   - birth_date
--   - gender
--   - home_city_id
--   - completion_state
--
-- Security:
--   - caller cannot choose another user_id
--   - raw user_profiles access remains protected
--   - browser receives no direct table UPDATE privilege
--   - avatar path must resolve to an object owned by auth.uid()
--   - profile completion remains PostgreSQL-owned
-- ============================================================


-- ============================================================
-- READ CURRENT AUTHENTICATED PROFILE
-- ============================================================

create or replace function public.get_my_profile()
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  bio text,
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
as $function$
  select
    up.user_id,
    up.display_name,
    up.avatar_path,
    up.bio,
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
$function$;

alter function public.get_my_profile()
  owner to postgres;

revoke all
on function public.get_my_profile()
from public;

revoke all
on function public.get_my_profile()
from anon;

grant execute
on function public.get_my_profile()
to authenticated;

comment on function public.get_my_profile() is
  'Returns the authenticated user''s authoritative profile using auth.uid() without granting browser SELECT access to public.user_profiles.';


-- ============================================================
-- UPDATE CURRENT AUTHENTICATED PROFILE
-- ============================================================

create or replace function public.update_my_profile(
  p_display_name text,
  p_avatar_path text,
  p_bio text
)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  bio text,
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
as $function$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_path text;
  v_bio text;
  v_profile public.user_profiles%rowtype;
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
  v_bio := nullif(btrim(p_bio), '');

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

  if v_bio is not null and char_length(v_bio) > 300 then
    raise exception
      using
        errcode = '22023',
        message = 'Bio is too long';
  end if;

  select up.*
  into v_profile
  from public.user_profiles up
  where up.user_id = v_user_id
  for update;

  if not found then
    raise exception
      using
        errcode = 'P0001',
        message = 'user_profile_not_found';
  end if;

  if v_profile.completion_state <> 'complete' then
    raise exception
      using
        errcode = 'P0001',
        message = 'user_profile_incomplete';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'profile-avatars'
      and o.name = v_avatar_path
      and (storage.foldername(o.name))[1] = v_user_id::text
      and coalesce(o.is_delete_marker, false) = false
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'Profile photo is invalid';
  end if;

  update public.user_profiles up
  set
    display_name = v_display_name,
    avatar_path = v_avatar_path,
    bio = v_bio,
    updated_at = now()
  where up.user_id = v_user_id;

  return query
  select
    up.user_id,
    up.display_name,
    up.avatar_path,
    up.bio,
    up.birth_date,
    up.gender,
    up.home_city_id,
    c.name,
    c.slug,
    s.code,
    s.name,
    up.completion_state
  from public.user_profiles up
  left join public.cities c
    on c.id = up.home_city_id
  left join public.states s
    on s.id = c.state_id
  where up.user_id = v_user_id;
end;
$function$;

alter function public.update_my_profile(
  text,
  text,
  text
)
owner to postgres;

revoke all
on function public.update_my_profile(
  text,
  text,
  text
)
from public;

revoke all
on function public.update_my_profile(
  text,
  text,
  text
)
from anon;

grant execute
on function public.update_my_profile(
  text,
  text,
  text
)
to authenticated;

comment on function public.update_my_profile(
  text,
  text,
  text
) is
  'Updates only the authenticated user''s display name, owned profile-avatar object path, and optional bio using auth.uid(); identity, eligibility, home city, and completion authority remain outside this RPC.';

commit;
