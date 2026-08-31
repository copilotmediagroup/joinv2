-- ============================================================
-- SIGNAL
-- Migration 0004
-- Authenticated member-scoped Realtime read access
-- ============================================================
--
-- Purpose:
--   1. Establish an authenticated, read-only RLS contract for
--      Signal formation state.
--   2. Avoid recursive RLS evaluation when membership policies
--      need to determine whether auth.uid() belongs to a group.
--   3. Publish the authoritative Signal formation tables to
--      Supabase Realtime.
--
-- Important:
--   - PostgreSQL remains authoritative.
--   - This migration grants no Signal mutation authority to
--     browser clients.
--   - The browser never supplies a trusted user UUID.
--   - Group access is derived from auth.uid().
--   - Former/declined/replaced members do not retain group read
--     access through the membership helper.
-- ============================================================


-- ============================================================
-- 1. ENSURE RLS IS PART OF THE REPOSITORY CONTRACT
-- ============================================================

alter table public.signal_intents
  enable row level security;

alter table public.signal_groups
  enable row level security;

alter table public.signal_group_memberships
  enable row level security;


-- ============================================================
-- 2. NON-RECURSIVE SIGNAL GROUP MEMBERSHIP HELPER
-- ============================================================
--
-- signal_group_memberships itself needs a policy that asks:
--
--   "Does the current authenticated user belong to this group?"
--
-- Querying signal_group_memberships directly from that policy
-- would recursively invoke its own RLS policy.
--
-- This narrowly-scoped SECURITY DEFINER helper performs only
-- that boolean membership test.
--
-- Security properties:
--   - caller does not provide a user UUID
--   - identity comes only from auth.uid()
--   - fixed search_path
--   - returns boolean only
--   - only current matched/confirmed memberships authorize reads
-- ============================================================

create or replace function public.is_signal_group_member(
  p_signal_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.signal_group_memberships sgm
      where
        sgm.signal_group_id = p_signal_group_id
        and sgm.user_id = auth.uid()
        and sgm.state in (
          'matched'::public.signal_group_membership_state,
          'confirmed'::public.signal_group_membership_state
        )
    );
$$;

alter function public.is_signal_group_member(uuid)
  owner to postgres;

revoke all
on function public.is_signal_group_member(uuid)
from public;

revoke all
on function public.is_signal_group_member(uuid)
from anon;

grant execute
on function public.is_signal_group_member(uuid)
to authenticated;

comment on function public.is_signal_group_member(uuid)
is
'Returns whether auth.uid() currently has a matched or confirmed membership in the specified Signal group. SECURITY DEFINER prevents recursive membership RLS evaluation; callers cannot supply a user identity.';


-- ============================================================
-- 3. SIGNAL INTENTS
-- ============================================================
--
-- Intent rows contain user-specific matching inputs.
-- An authenticated user may read only their own intent rows.
-- ============================================================

drop policy if exists
  signal_intents_select_own
on public.signal_intents;

create policy
  signal_intents_select_own
on public.signal_intents
for select
to authenticated
using (
  user_id = auth.uid()
);


-- ============================================================
-- 4. SIGNAL GROUPS
-- ============================================================
--
-- A group is visible only to a current member of that group.
-- ============================================================

drop policy if exists
  signal_groups_select_member
on public.signal_groups;

create policy
  signal_groups_select_member
on public.signal_groups
for select
to authenticated
using (
  public.is_signal_group_member(id)
);


-- ============================================================
-- 5. SIGNAL GROUP MEMBERSHIPS
-- ============================================================
--
-- A member must be able to observe the other membership rows in
-- their own Signal so participant arrivals, confirmations,
-- withdrawals, replacements, and Live Rail state can update.
--
-- Membership in one Signal never grants visibility into another.
-- ============================================================

drop policy if exists
  signal_group_memberships_select_member_group
on public.signal_group_memberships;

create policy
  signal_group_memberships_select_member_group
on public.signal_group_memberships
for select
to authenticated
using (
  public.is_signal_group_member(signal_group_id)
);


-- ============================================================
-- 6. READ PRIVILEGE CONTRACT
-- ============================================================
--
-- RLS decides which rows authenticated users can see.
-- Anonymous clients receive no SELECT access to these formation
-- tables.
-- ============================================================

revoke select
on table
  public.signal_intents,
  public.signal_groups,
  public.signal_group_memberships
from anon;

grant select
on table
  public.signal_intents,
  public.signal_groups,
  public.signal_group_memberships
to authenticated;


-- ============================================================
-- 7. SUPABASE REALTIME PUBLICATION
-- ============================================================
--
-- PostgreSQL changes become eligible for Realtime delivery only
-- after the tables belong to supabase_realtime.
--
-- Membership of the publication is checked individually so this
-- migration remains safe if a table has already been enabled in
-- a controlled environment.
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception
      'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where
      pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'signal_intents'
  ) then
    alter publication supabase_realtime
      add table public.signal_intents;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where
      pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'signal_groups'
  ) then
    alter publication supabase_realtime
      add table public.signal_groups;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where
      pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'signal_group_memberships'
  ) then
    alter publication supabase_realtime
      add table public.signal_group_memberships;
  end if;
end
$$;


-- ============================================================
-- END MIGRATION 0004
-- ============================================================
