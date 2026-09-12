begin;

-- ============================================================
-- SIGNAL
-- 0013_profile_avatar_storage_authority.sql
--
-- Purpose:
--   Create private authenticated profile-avatar storage.
--
-- Object path contract:
--   profile-avatars/<auth.uid()>/<filename>
--
-- Security:
--   - private bucket
--   - no anonymous access
--   - authenticated user may manage only their own folder
--   - no cross-user write/delete
--   - no service key or browser secret dependency
-- ============================================================


-- ============================================================
-- BUCKET
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id)
do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ============================================================
-- REMOVE ONLY OUR OWN POLICY NAMES FOR IDEMPOTENT REAPPLY SAFETY
-- ============================================================

drop policy if exists
  "profile_avatars_select_own"
on storage.objects;

drop policy if exists
  "profile_avatars_insert_own"
on storage.objects;

drop policy if exists
  "profile_avatars_update_own"
on storage.objects;

drop policy if exists
  "profile_avatars_delete_own"
on storage.objects;


-- ============================================================
-- SELECT OWN AVATAR OBJECTS
-- ============================================================

create policy
  "profile_avatars_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- INSERT OWN AVATAR OBJECTS
-- ============================================================

create policy
  "profile_avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- UPDATE OWN AVATAR OBJECTS
-- ============================================================

create policy
  "profile_avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- DELETE OWN AVATAR OBJECTS
-- ============================================================

create policy
  "profile_avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);


commit;
