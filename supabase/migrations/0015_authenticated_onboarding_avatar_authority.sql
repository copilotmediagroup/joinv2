begin;

-- ============================================================
-- SIGNAL
-- 0015_authenticated_onboarding_avatar_authority.sql
--
-- Harden complete_my_onboarding():
--
--   Browser supplies an avatar object path, but PostgreSQL owns
--   the authority decision.
--
-- Required avatar contract:
--   profile-avatars/<auth.uid()>/<object>
--
-- The object must already exist in storage.objects.
-- A caller cannot complete onboarding using another user's
-- avatar path or an invented/nonexistent object.
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
as $function$
declare
  v_user_id uuid;
  v_display_name text;
  v_avatar_path text;
  v_expected_avatar_prefix text;
  v_avatar_exists boolean;
  v_city public.cities%rowtype;
  v_state public.states%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication required';
  end if;

  v_display_name := nullif(btrim(p_display_name), '');
  v_avatar_path := nullif(btrim(p_avatar_path), '');

  if v_display_name is null then
    raise exception using
      errcode = '22023',
      message = 'Display name is required';
  end if;

  if char_length(v_display_name) > 80 then
    raise exception using
      errcode = '22023',
      message = 'Display name is too long';
  end if;

  if v_avatar_path is null then
    raise exception using
      errcode = '22023',
      message = 'Profile photo is required';
  end if;

  -- ----------------------------------------------------------
  -- Avatar authority
  --
  -- storage.objects.name stores the object name relative to
  -- the bucket, so the canonical value persisted in
  -- user_profiles.avatar_path is:
  --
  --   <auth.uid()>/<filename>
  --
  -- The bucket itself is separately fixed to profile-avatars.
  -- ----------------------------------------------------------

  v_expected_avatar_prefix := v_user_id::text || '/';

  if left(
    v_avatar_path,
    char_length(v_expected_avatar_prefix)
  ) <> v_expected_avatar_prefix then
    raise exception using
      errcode = '22023',
      message = 'Profile photo path is not owned by authenticated user';
  end if;

  -- Require an actual object below the user's folder.
  -- Reject the bare "<uid>/" folder path.
  if char_length(v_avatar_path)
       <= char_length(v_expected_avatar_prefix) then
    raise exception using
      errcode = '22023',
      message = 'Profile photo path is invalid';
  end if;

  select exists (
    select 1
    from storage.objects so
    where so.bucket_id = 'profile-avatars'
      and so.name = v_avatar_path
      and (storage.foldername(so.name))[1] = v_user_id::text
      and coalesce(so.is_delete_marker, false) = false
  )
  into v_avatar_exists;

  if not v_avatar_exists then
    raise exception using
      errcode = '22023',
      message = 'Profile photo does not exist';
  end if;

  if p_birth_date is null then
    raise exception using
      errcode = '22023',
      message = 'Birth date is required';
  end if;

  if p_birth_date > current_date then
    raise exception using
      errcode = '22023',
      message = 'Birth date cannot be in the future';
  end if;

  if p_gender is null then
    raise exception using
      errcode = '22023',
      message = 'Gender is required';
  end if;

  if p_home_city_id is null then
    raise exception using
      errcode = '22023',
      message = 'Home city is required';
  end if;

  select c.*
  into v_city
  from public.cities c
  where c.id = p_home_city_id
    and c.is_active = true;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Home city is invalid or inactive';
  end if;

  select s.*
  into v_state
  from public.states s
  where s.id = v_city.state_id
    and s.is_active = true;

  if not found then
    raise exception using
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
    raise exception using
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
$function$;

alter function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
owner to postgres;

revoke all on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
from public;

revoke all on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
from anon;

grant execute on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
to authenticated;

comment on function public.complete_my_onboarding(
  text,
  text,
  date,
  public.profile_gender,
  uuid
)
is
  'Completes the authenticated user profile after validating canonical city/state authority and an existing avatar object owned by auth.uid() in the private profile-avatars bucket.';

commit;
