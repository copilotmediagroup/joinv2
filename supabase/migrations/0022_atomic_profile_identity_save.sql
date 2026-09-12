begin;

-- ============================================================
-- G4.18-I15
-- ATOMIC AUTHENTICATED PROFILE + IDENTITY GALLERY SAVE
--
-- One PostgreSQL transaction owns:
--   - display_name
--   - avatar_path
--   - bio
--   - complete additional identity-gallery membership/order
--
-- Browser authority remains auth.uid().
--
-- Storage-byte upload occurs before this RPC and Storage cleanup
-- for removed objects occurs after successful DB commit.
--
-- This RPC intentionally does NOT support silently promoting an
-- existing gallery photo to primary or demoting the current
-- primary into the additional gallery. Those role changes require
-- a dedicated future authoritative operation.
-- ============================================================

create or replace function public.save_my_profile_with_identity_gallery(
  p_display_name text,
  p_avatar_path text,
  p_bio text,
  p_expected_gallery_object_paths text[],
  p_gallery_object_paths text[]
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
  completion_state public.profile_completion_state,
  identity_photos jsonb,
  removed_object_paths text[]
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

  v_expected_gallery_paths text[];
  v_gallery_paths text[];
  v_current_gallery_paths text[];

  v_expected_count integer;
  v_gallery_count integer;
  v_distinct_gallery_count integer;
  v_valid_storage_count integer;

  v_removed_object_paths text[];
begin
  -- ----------------------------------------------------------
  -- AUTHENTICATED CALLER
  -- ----------------------------------------------------------

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception
      using
        errcode = '28000',
        message = 'Authentication required';
  end if;

  -- ----------------------------------------------------------
  -- NORMALIZE PROFILE INPUT
  -- ----------------------------------------------------------

  v_display_name := nullif(
    btrim(p_display_name),
    ''
  );

  v_avatar_path := nullif(
    btrim(p_avatar_path),
    ''
  );

  v_bio := nullif(
    btrim(p_bio),
    ''
  );

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

  if v_bio is not null
     and char_length(v_bio) > 300 then
    raise exception
      using
        errcode = '22023',
        message = 'Bio is too long';
  end if;

  -- ----------------------------------------------------------
  -- REQUIRE BOTH COMPLETE-GALLERY ARRAYS
  -- ----------------------------------------------------------

  if p_expected_gallery_object_paths is null then
    raise exception
      using
        errcode = '22023',
        message = 'Expected identity gallery is required';
  end if;

  if p_gallery_object_paths is null then
    raise exception
      using
        errcode = '22023',
        message = 'Identity gallery is required';
  end if;

  select coalesce(
    array_agg(
      btrim(item.object_path)
      order by item.ordinality
    ),
    array[]::text[]
  )
  into v_expected_gallery_paths
  from unnest(
    p_expected_gallery_object_paths
  ) with ordinality
    as item(object_path, ordinality);

  select coalesce(
    array_agg(
      btrim(item.object_path)
      order by item.ordinality
    ),
    array[]::text[]
  )
  into v_gallery_paths
  from unnest(
    p_gallery_object_paths
  ) with ordinality
    as item(object_path, ordinality);

  v_expected_count :=
    cardinality(v_expected_gallery_paths);

  v_gallery_count :=
    cardinality(v_gallery_paths);

  if exists (
    select 1
    from unnest(v_expected_gallery_paths)
      as expected_path
    where nullif(
      btrim(expected_path),
      ''
    ) is null
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'Expected identity gallery contains an invalid path';
  end if;

  if exists (
    select 1
    from unnest(v_gallery_paths)
      as desired_path
    where nullif(
      btrim(desired_path),
      ''
    ) is null
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'Identity gallery contains an invalid path';
  end if;

  if v_gallery_count > 5 then
    raise exception
      using
        errcode = '22023',
        message = 'Identity gallery cannot contain more than five additional photos';
  end if;

  select count(
    distinct desired_path
  )::integer
  into v_distinct_gallery_count
  from unnest(v_gallery_paths)
    as desired_path;

  if v_distinct_gallery_count <> v_gallery_count then
    raise exception
      using
        errcode = '22023',
        message = 'Identity gallery cannot contain duplicate photos';
  end if;

  -- ----------------------------------------------------------
  -- SERIALIZE ALL PROFILE/GALLERY MUTATION FOR THIS USER
  -- ----------------------------------------------------------

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

  -- ----------------------------------------------------------
  -- OPTIMISTIC GALLERY CONCURRENCY GUARD
  --
  -- The browser supplies the exact gallery snapshot from the
  -- beginning of its edit session. A stale editor may not silently
  -- overwrite a newer authoritative gallery.
  -- ----------------------------------------------------------

  select coalesce(
    array_agg(
      pip.object_path
      order by
        pip.position asc,
        pip.created_at asc,
        pip.id asc
    ),
    array[]::text[]
  )
  into v_current_gallery_paths
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id;

  if v_current_gallery_paths
     is distinct from v_expected_gallery_paths then
    raise exception
      using
        errcode = 'P0001',
        message = 'Identity gallery changed; reload profile and try again';
  end if;

  -- ----------------------------------------------------------
  -- PRIMARY AVATAR STORAGE AUTHORITY
  -- Mirrors the live 0020 contract.
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'profile-avatars'
      and o.name = v_avatar_path
      and (storage.foldername(o.name))[1] =
        v_user_id::text
      and coalesce(
        o.is_delete_marker,
        false
      ) = false
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'Profile photo is invalid';
  end if;

  -- ----------------------------------------------------------
  -- NO SILENT PRIMARY/GALLERY ROLE SWAPS
  -- ----------------------------------------------------------

  if v_avatar_path = any(v_gallery_paths) then
    raise exception
      using
        errcode = '22023',
        message = 'Primary profile photo cannot also be an additional identity photo';
  end if;

  if v_profile.avatar_path is not null
     and v_profile.avatar_path = any(v_gallery_paths) then
    raise exception
      using
        errcode = '22023',
        message = 'Current primary profile photo cannot be moved into the additional gallery by this save';
  end if;

  if v_avatar_path is distinct from v_profile.avatar_path
     and exists (
       select 1
       from public.profile_identity_photos pip
       where pip.user_id = v_user_id
         and pip.object_path = v_avatar_path
     ) then
    raise exception
      using
        errcode = '22023',
        message = 'Additional identity photo cannot be promoted to primary by this save';
  end if;

  -- ----------------------------------------------------------
  -- VALIDATE EVERY DESIRED ADDITIONAL STORAGE OBJECT
  -- ----------------------------------------------------------

  if v_gallery_count > 0 then
    select count(*)::integer
    into v_valid_storage_count
    from storage.objects o
    where o.bucket_id = 'profile-avatars'
      and o.name = any(v_gallery_paths)
      and (storage.foldername(o.name))[1] =
        v_user_id::text
      and coalesce(
        o.is_delete_marker,
        false
      ) = false;

    if v_valid_storage_count <> v_gallery_count then
      raise exception
        using
          errcode = '22023',
          message = 'Identity gallery contains an invalid photo';
    end if;
  else
    v_valid_storage_count := 0;
  end if;

  -- ----------------------------------------------------------
  -- CAPTURE STORAGE PATHS THAT BECOME UNUSED
  -- Storage cleanup happens only AFTER this DB transaction commits.
  -- ----------------------------------------------------------

  select coalesce(
    array_agg(
      pip.object_path
      order by
        pip.position asc,
        pip.created_at asc,
        pip.id asc
    ),
    array[]::text[]
  )
  into v_removed_object_paths
  from public.profile_identity_photos pip
  where pip.user_id = v_user_id
    and not (
      pip.object_path = any(v_gallery_paths)
    );

  -- ----------------------------------------------------------
  -- ATOMIC GALLERY RECONCILIATION
  --
  -- Preserve metadata IDs/created_at for retained objects.
  -- Delete removed rows.
  -- Insert newly-added rows.
  -- Rewrite final authoritative positions.
  -- ----------------------------------------------------------

  set constraints
    profile_identity_photos_user_position_unique
    deferred;

  delete from public.profile_identity_photos pip
  where pip.user_id = v_user_id
    and not (
      pip.object_path = any(v_gallery_paths)
    );

  insert into public.profile_identity_photos (
    user_id,
    object_path,
    position
  )
  select
    v_user_id,
    desired.object_path,
    desired.ordinality::smallint
  from unnest(v_gallery_paths)
    with ordinality
    as desired(object_path, ordinality)
  where not exists (
    select 1
    from public.profile_identity_photos pip
    where pip.user_id = v_user_id
      and pip.object_path = desired.object_path
  );

  update public.profile_identity_photos pip
  set position =
    array_position(
      v_gallery_paths,
      pip.object_path
    )::smallint
  where pip.user_id = v_user_id;

  -- ----------------------------------------------------------
  -- PROFILE UPDATE
  --
  -- Gallery is reconciled first so cross-table invariants see the
  -- final desired gallery when avatar_path is updated.
  -- ----------------------------------------------------------

  update public.user_profiles up
  set
    display_name = v_display_name,
    avatar_path = v_avatar_path,
    bio = v_bio,
    updated_at = now()
  where up.user_id = v_user_id;

  -- ----------------------------------------------------------
  -- RETURN AUTHORITATIVE PROFILE + GALLERY + CLEANUP PATHS
  -- ----------------------------------------------------------

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
    up.completion_state,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id',
            pip.id,
            'object_path',
            pip.object_path,
            'position',
            pip.position,
            'created_at',
            pip.created_at
          )
          order by
            pip.position asc,
            pip.created_at asc,
            pip.id asc
        )
        from public.profile_identity_photos pip
        where pip.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    v_removed_object_paths
  from public.user_profiles up
  left join public.cities c
    on c.id = up.home_city_id
  left join public.states s
    on s.id = c.state_id
  where up.user_id = v_user_id;
end;
$function$;

alter function public.save_my_profile_with_identity_gallery(
  text,
  text,
  text,
  text[],
  text[]
)
  owner to postgres;

revoke all
on function public.save_my_profile_with_identity_gallery(
  text,
  text,
  text,
  text[],
  text[]
)
from public;

revoke all
on function public.save_my_profile_with_identity_gallery(
  text,
  text,
  text,
  text[],
  text[]
)
from anon;

grant execute
on function public.save_my_profile_with_identity_gallery(
  text,
  text,
  text,
  text[],
  text[]
)
to authenticated;

comment on function public.save_my_profile_with_identity_gallery(
  text,
  text,
  text,
  text[],
  text[]
) is
  'Atomically saves auth.uid()''s editable profile fields and complete additional identity gallery after validating profile/avatar ownership, every desired private profile-avatars object, five-photo capacity, primary/gallery separation, and the caller''s expected gallery snapshot. Returns authoritative profile/gallery state and removed Storage paths for post-commit cleanup.';

commit;
