begin;

-- ============================================================
-- SIGNAL
-- 0011_auth_user_profile_bootstrap.sql
--
-- Purpose:
--   Every newly-created Supabase Auth user must have exactly one
--   corresponding public.user_profiles row.
--
-- Security / authority contract:
--   - auth.users owns authenticated identity
--   - user_profiles.user_id is the same Auth UUID
--   - profile begins incomplete
--   - no city is guessed
--   - no name is invented
--   - no avatar is invented
--   - no birth date is invented
--   - no gender is invented
--   - no entitlement is invented
--   - browser receives no direct user_profiles table privilege
--   - PostgreSQL owns bootstrap integrity
-- ============================================================

create or replace function public.bootstrap_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_profiles (
    user_id
  )
  values (
    new.id
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

alter function public.bootstrap_auth_user_profile()
  owner to postgres;

revoke all
on function public.bootstrap_auth_user_profile()
from public;

revoke all
on function public.bootstrap_auth_user_profile()
from anon;

revoke all
on function public.bootstrap_auth_user_profile()
from authenticated;

drop trigger if exists
  signal_bootstrap_auth_user_profile
on auth.users;

create trigger signal_bootstrap_auth_user_profile
after insert
on auth.users
for each row
execute function public.bootstrap_auth_user_profile();

-- Repair any historical Auth users that somehow lack a profile.
-- This is idempotent. On the currently verified production state
-- this should insert zero rows because all Auth users have profiles.
insert into public.user_profiles (
  user_id
)
select
  u.id
from auth.users u
left join public.user_profiles up
  on up.user_id = u.id
where up.user_id is null
on conflict (user_id) do nothing;

comment on function public.bootstrap_auth_user_profile()
is
'Creates exactly one incomplete public.user_profiles row for each newly-created auth.users identity. It does not invent onboarding/profile values and is intended for trigger execution only.';

commit;
