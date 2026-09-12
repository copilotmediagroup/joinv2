begin;

-- ============================================================
-- SIGNAL
-- 0014_profile_avatar_authenticated_read_authority.sql
--
-- Repair:
--   Profile avatars are social/profile presentation media.
--   Any authenticated SIGNAL user must be able to read them.
--
-- Security remains:
--   - bucket is private
--   - anonymous users have no access
--   - write/update/delete remain owner-folder restricted
-- ============================================================

drop policy if exists
  "profile_avatars_select_own"
on storage.objects;

drop policy if exists
  "profile_avatars_select_authenticated"
on storage.objects;

create policy
  "profile_avatars_select_authenticated"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-avatars'
);

commit;
