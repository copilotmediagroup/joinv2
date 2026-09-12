begin;

-- ============================================================
-- SIGNAL
-- 0021_profile_identity_gallery.sql
--
-- Purpose:
--   Establish authoritative ownership and ordering for the
--   authenticated user's additional identity photos.
--
-- Product contract:
--   - user_profiles.avatar_path remains the one primary avatar.
--   - profile_identity_photos contains at most five additional
--     identity photos.
--   - therefore a profile may present at most six identity photos
--     total: one primary + five additional.
--
-- Storage:
--   Additional identity photos reuse the existing private
--   profile-avatars bucket.
--
--   Canonical object path:
--     <auth.uid()>/<object>
--
-- Authority:
--   - caller identity comes only from auth.uid()
--   - browser receives no direct table privileges
--   - PostgreSQL validates object existence and owner folder
--   - PostgreSQL owns gallery capacity and ordering
--
-- Deliberately NOT included here:
--   - public/other-user profile gallery read authority
--   - SIGNAL Moments
--   - videos
--   - arbitrary feed posting
-- ============================================================


-- ============================================================
-- TABLE
-- ============================================================

create table public.profile_identity_photos (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.user_profiles(user_id)
    on delete cascade,

  object_path text not null,

  position smallint not null,

  created_at timestamptz not null default now(),

  constraint profile_identity_photos_position_check
    check (
      position between 1 and 5
    ),

  constraint profile_identity_photos_user_object_unique
    unique (
      user_id,
      object_path
    ),

  constraint profile_identity_photos_user_position_unique
    unique (
      user_id,
      position
    )
    deferrable initially immediate
);


-- ============================================================
-- TABLE SECURITY
-- ============================================================

alter table public.profile_identity_photos
  enable row level security;

revoke all
on table public.profile_identity_photos
from public;

revoke all
on table public.profile_identity_photos
from anon;

revoke all
on table public.profile_identity_photos
from authenticated;


-- ============================================================
-- READ AUTHENTICATED USER'S OWN ADDITIONAL PHOTOS
-- ============================================================

create or replace function public.get_my_identity_photos()
returns table (
  id uuid,
  object_path text,
  "position" smallint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    pip.id,
    pip.object_path,
    pip.position,
    pip.created_at
  from public.profile_identity_photos pip
  where pip.user_id = auth.uid()
  order by
    pip.position asc,
    pip.created_at asc,
    pip.id asc;
$function$;

alter function public.get_my_identity_photos()
  owner to postgres;

revoke all
on function public.get_my_identity_photos()
from public;

revoke all
on function public.get_my_identity_photos()
from anon;

grant execute
on function public.get_my_identity_photos()
to authenticated;

comment on function public.get_my_identity_photos() is
  'Returns auth.uid()''s additional identity photos in authoritative gallery order without granting direct profile_identity_photos table access.';


-- ============================================================
-- ADD ONE ADDITIONAL IDENTITY PHOTO
-- ============================================================

create or replace function public.add_my_identity_photo(
  p_object_path text
)
returns table (
  id uuid,
  object_path text,
  "position" smallint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_object_path text;
  v_expected_prefix text;
  v_primary_avatar_path text;
  v_current_count integer;
  v_next_position smallint;
  v_inserted public.profile_identity_photos%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  v_object_path := nullif(
    btrim(p_object_path),
    ''
  );

  if v_object_path is null then
    raise exception using
      errcode = '22023',
      message = 'Identity photo path is required';
  end if;

  -- Serialize all gallery mutations for this user using the
  -- authoritative profile row as the per-user lock.
  select
    up.avatar_path
  into
    v_primary_avatar_path
  from public.user_profiles up
  where up.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Authenticated profile not found';
  end if;

  v_expected_prefix := v_user_id::text || '/';

  if left(
    v_object_path,
    char_length(v_expected_prefix)
  ) <> v_expected_prefix then
    raise exception using
      errcode = '22023',
      message = 'Identity photo path is not owned by authenticated user';
  end if;

  if char_length(v_object_path)
       <= char_length(v_expected_prefix) then
    raise exception using
      errcode = '22023',
      message = 'Identity photo path is invalid';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'profile-avatars'
      and o.name = v_object_path
      and coalesce(
        o.is_delete_marker,
        false
      ) = false
  ) then
    raise exception using
      errcode = '22023',
      message = 'Identity photo is invalid';
  end if;

  -- The primary avatar is represented by user_profiles.avatar_path,
  -- not duplicated in the five-photo additional gallery.
  if v_primary_avatar_path is not null
     and v_object_path = v_primary_avatar_path then
    raise exception using
      errcode = '22023',
      message = 'Primary profile photo cannot also be an additional identity photo';
  end if;

  if exists (
    select 1
    from public.profile_identity_photos pip
    where pip.user_id = v_user_id
      and pip.object_path = v_object_path
  ) then
    raise exception using
      errcode = '23505',
      message = 'Identity photo is already in gallery';
  end if;

  select
    count(*)::integer,
    coalesce(
      max(pip.position),
      0
    )::smallint
  into
    v_current_count,
    v_next_position
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id;

  if v_current_count >= 5 then
    raise exception using
      errcode = '22023',
      message = 'Identity gallery already has five additional photos';
  end if;

  v_next_position :=
    (v_next_position + 1)::smallint;

  insert into public.profile_identity_photos (
    user_id,
    object_path,
    position
  )
  values (
    v_user_id,
    v_object_path,
    v_next_position
  )
  returning *
  into v_inserted;

  return query
  select
    v_inserted.id,
    v_inserted.object_path,
    v_inserted.position,
    v_inserted.created_at;
end;
$function$;

alter function public.add_my_identity_photo(text)
  owner to postgres;

revoke all
on function public.add_my_identity_photo(text)
from public;

revoke all
on function public.add_my_identity_photo(text)
from anon;

grant execute
on function public.add_my_identity_photo(text)
to authenticated;

comment on function public.add_my_identity_photo(text) is
  'Adds one owned profile-avatars object to auth.uid()''s additional identity gallery, enforcing object existence, owner-folder authority, primary-avatar separation, uniqueness, and the five-photo capacity limit.';


-- ============================================================
-- REMOVE ONE ADDITIONAL IDENTITY PHOTO
-- ============================================================

create or replace function public.remove_my_identity_photo(
  p_photo_id uuid
)
returns table (
  id uuid,
  object_path text,
  "position" smallint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_removed public.profile_identity_photos%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  if p_photo_id is null then
    raise exception using
      errcode = '22023',
      message = 'Identity photo id is required';
  end if;

  perform 1
  from public.user_profiles up
  where up.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Authenticated profile not found';
  end if;

  delete from public.profile_identity_photos pip
  where pip.id = p_photo_id
    and pip.user_id = v_user_id
  returning *
  into v_removed;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Identity photo not found';
  end if;

  -- Close any ordering gap after the removed photo.
  update public.profile_identity_photos pip
  set position =
    (pip.position - 1)::smallint
  where pip.user_id = v_user_id
    and pip.position > v_removed.position;

  return query
  select
    v_removed.id,
    v_removed.object_path,
    v_removed.position,
    v_removed.created_at;
end;
$function$;

alter function public.remove_my_identity_photo(uuid)
  owner to postgres;

revoke all
on function public.remove_my_identity_photo(uuid)
from public;

revoke all
on function public.remove_my_identity_photo(uuid)
from anon;

grant execute
on function public.remove_my_identity_photo(uuid)
to authenticated;

comment on function public.remove_my_identity_photo(uuid) is
  'Removes one additional identity-photo metadata row owned by auth.uid() and compacts the remaining authoritative gallery order. Storage-byte deletion is intentionally outside this database metadata transaction.';


-- ============================================================
-- REORDER AUTHENTICATED USER'S COMPLETE ADDITIONAL GALLERY
-- ============================================================

create or replace function public.reorder_my_identity_photos(
  p_photo_ids uuid[]
)
returns table (
  id uuid,
  object_path text,
  "position" smallint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_current_count integer;
  v_requested_count integer;
  v_distinct_requested_count integer;
  v_owned_requested_count integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required';
  end if;

  if p_photo_ids is null then
    raise exception using
      errcode = '22023',
      message = 'Identity photo order is required';
  end if;

  perform 1
  from public.user_profiles up
  where up.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Authenticated profile not found';
  end if;

  select count(*)::integer
  into v_current_count
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id;

  v_requested_count :=
    cardinality(p_photo_ids);

  select count(distinct requested_id)::integer
  into v_distinct_requested_count
  from unnest(p_photo_ids) requested_id;

  select count(*)::integer
  into v_owned_requested_count
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id
    and pip.id = any(p_photo_ids);

  if v_requested_count <> v_current_count
     or v_distinct_requested_count <> v_current_count
     or v_owned_requested_count <> v_current_count then
    raise exception using
      errcode = '22023',
      message = 'Identity photo order must contain every current gallery photo exactly once';
  end if;

  -- Allow swaps without transient uniqueness collisions.
  set constraints
    profile_identity_photos_user_position_unique
    deferred;

  update public.profile_identity_photos pip
  set position =
    array_position(
      p_photo_ids,
      pip.id
    )::smallint
  where pip.user_id = v_user_id;

  return query
  select
    pip.id,
    pip.object_path,
    pip.position,
    pip.created_at
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id
  order by
    pip.position asc,
    pip.created_at asc,
    pip.id asc;
end;
$function$;

alter function public.reorder_my_identity_photos(uuid[])
  owner to postgres;

revoke all
on function public.reorder_my_identity_photos(uuid[])
from public;

revoke all
on function public.reorder_my_identity_photos(uuid[])
from anon;

grant execute
on function public.reorder_my_identity_photos(uuid[])
to authenticated;

comment on function public.reorder_my_identity_photos(uuid[]) is
  'Reorders auth.uid()''s complete additional identity gallery atomically. The caller must supply every current owned gallery photo exactly once; PostgreSQL owns final positions 1 through 5.';



-- ============================================================
-- CROSS-TABLE PRIMARY / ADDITIONAL PHOTO INVARIANT
--
-- The primary avatar lives on public.user_profiles.avatar_path.
-- Additional identity photos live on
-- public.profile_identity_photos.object_path.
--
-- The same object must never occupy both roles.
--
-- Enforcement is bidirectional:
--
--   1. INSERT/UPDATE of an additional photo cannot select the
--      current primary avatar.
--
--   2. UPDATE of user_profiles.avatar_path cannot select an
--      object already present in the additional gallery.
--
-- This protects the invariant regardless of which authoritative
-- mutation path executes first.
-- ============================================================


-- ------------------------------------------------------------
-- Guard additional-photo writes against current primary avatar
-- ------------------------------------------------------------

create or replace function public.enforce_identity_photo_not_primary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_primary_avatar_path text;
begin
  select up.avatar_path
  into v_primary_avatar_path
  from public.user_profiles up
  where up.user_id = new.user_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Identity photo profile does not exist';
  end if;

  if v_primary_avatar_path is not null
     and new.object_path = v_primary_avatar_path then
    raise exception using
      errcode = '22023',
      message = 'Primary profile photo cannot also be an additional identity photo';
  end if;

  return new;
end;
$function$;

alter function public.enforce_identity_photo_not_primary()
  owner to postgres;

revoke all
on function public.enforce_identity_photo_not_primary()
from public;

revoke all
on function public.enforce_identity_photo_not_primary()
from anon;

revoke all
on function public.enforce_identity_photo_not_primary()
from authenticated;

drop trigger if exists
  profile_identity_photos_guard_primary_avatar
on public.profile_identity_photos;

create trigger
  profile_identity_photos_guard_primary_avatar
before insert or update of user_id, object_path
on public.profile_identity_photos
for each row
execute function public.enforce_identity_photo_not_primary();


-- ------------------------------------------------------------
-- Guard primary-avatar updates against additional gallery
-- ------------------------------------------------------------

create or replace function public.enforce_primary_avatar_not_identity_photo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.avatar_path is not null
     and exists (
       select 1
       from public.profile_identity_photos pip
       where pip.user_id = new.user_id
         and pip.object_path = new.avatar_path
     ) then
    raise exception using
      errcode = '22023',
      message = 'Additional identity photo cannot also be the primary profile photo';
  end if;

  return new;
end;
$function$;

alter function public.enforce_primary_avatar_not_identity_photo()
  owner to postgres;

revoke all
on function public.enforce_primary_avatar_not_identity_photo()
from public;

revoke all
on function public.enforce_primary_avatar_not_identity_photo()
from anon;

revoke all
on function public.enforce_primary_avatar_not_identity_photo()
from authenticated;

drop trigger if exists
  user_profiles_guard_identity_gallery_avatar
on public.user_profiles;

create trigger
  user_profiles_guard_identity_gallery_avatar
before update of avatar_path
on public.user_profiles
for each row
when (
  old.avatar_path is distinct from new.avatar_path
)
execute function public.enforce_primary_avatar_not_identity_photo();


commit;
