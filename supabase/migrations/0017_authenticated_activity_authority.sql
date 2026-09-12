begin;

-- ============================================================
-- 0017_authenticated_activity_authority.sql
--
-- AUTHENTICATED ACTIVITY AUTHORITY
--
-- Purpose:
--   Give the signed-in user one authoritative projection of
--   their current SIGNAL / Plan participation.
--
-- Security:
--   * caller supplies no user UUID
--   * identity comes only from auth.uid()
--   * fixed search_path
--   * SECURITY DEFINER
--   * no widening of Signal or Plan table RLS
--   * anonymous execution denied
--
-- Activity semantics:
--
--   SIGNAL
--     - caller has matched/confirmed membership
--     - group remains operational
--
--   PLAN
--     - caller has active membership
--     - plan remains operational
--
--   Converted SIGNALs are represented by their Plan rather than
--   duplicated as both a SIGNAL and a Plan.
-- ============================================================

create or replace function public.get_my_activity()
returns table (
  item_type text,
  item_id uuid,
  signal_group_id uuid,
  signal_intent_id uuid,
  plan_id uuid,
  activity_id uuid,
  activity_slug text,
  activity_name text,
  lifecycle_state text,
  membership_state text,
  is_active_core boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  joined_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with caller as (
    select auth.uid() as user_id
  ),

  my_signals as (
    select
      'signal'::text as item_type,
      sg.id as item_id,
      sg.id as signal_group_id,
      sgm.originating_signal_intent_id as signal_intent_id,
      null::uuid as plan_id,
      sg.activity_id,
      a.slug as activity_slug,
      a.name as activity_name,
      sg.state::text as lifecycle_state,
      sgm.state::text as membership_state,
      sgm.is_active_core,
      si.starts_at,
      si.ends_at,
      sg.expires_at,
      null::timestamptz as scheduled_starts_at,
      null::timestamptz as scheduled_ends_at,
      sgm.matched_at as joined_at,
      greatest(
        sg.updated_at,
        sgm.updated_at,
        coalesce(si.updated_at, '-infinity'::timestamptz)
      ) as updated_at
    from caller c
    join public.signal_group_memberships sgm
      on sgm.user_id = c.user_id
    join public.signal_groups sg
      on sg.id = sgm.signal_group_id
    left join public.signal_intents si
      on si.id = sgm.originating_signal_intent_id
    join public.activities a
      on a.id = sg.activity_id
    where
      c.user_id is not null
      and sgm.state in (
        'matched'::public.signal_group_membership_state,
        'confirmed'::public.signal_group_membership_state
      )
      and sg.state in (
        'forming'::public.signal_group_state,
        'confirming'::public.signal_group_state,
        'coordinating'::public.signal_group_state,
        'locked'::public.signal_group_state,
        'active_outing'::public.signal_group_state
      )
      and sg.expires_at > now()

      -- Once converted, the Plan is the authoritative Activity
      -- item. Do not display the same journey twice.
      and not exists (
        select 1
        from public.plans p
        where p.originating_signal_group_id = sg.id
      )
  ),

  my_plans as (
    select
      'plan'::text as item_type,
      p.id as item_id,
      p.originating_signal_group_id as signal_group_id,
      null::uuid as signal_intent_id,
      p.id as plan_id,
      p.activity_id,
      a.slug as activity_slug,
      a.name as activity_name,
      p.state::text as lifecycle_state,
      pm.membership_state::text as membership_state,
      pm.locked_member as is_active_core,
      null::timestamptz as starts_at,
      null::timestamptz as ends_at,
      null::timestamptz as expires_at,
      p.scheduled_starts_at,
      p.scheduled_ends_at,
      pm.joined_at,
      greatest(
        p.updated_at,
        pm.updated_at
      ) as updated_at
    from caller c
    join public.plan_memberships pm
      on pm.user_id = c.user_id
    join public.plans p
      on p.id = pm.plan_id
    join public.activities a
      on a.id = p.activity_id
    where
      c.user_id is not null
      and pm.membership_state =
        'active'::public.plan_membership_state
      and p.state in (
        'published'::public.plan_state,
        'locked'::public.plan_state,
        'recovery_required'::public.plan_state,
        'active_outing'::public.plan_state
      )
  )

  select *
  from (
    select * from my_signals

    union all

    select * from my_plans
  ) activity_items
  order by
    coalesce(
      scheduled_starts_at,
      starts_at,
      updated_at
    ) asc,
    updated_at desc,
    item_id;
$$;

alter function public.get_my_activity()
  owner to postgres;

revoke all
on function public.get_my_activity()
from public;

revoke all
on function public.get_my_activity()
from anon;

grant execute
on function public.get_my_activity()
to authenticated;

comment on function public.get_my_activity()
is
'Returns auth.uid()''s authoritative current SIGNAL and Plan participation. Caller supplies no user identity. Converted Signals are represented by their Plan to prevent duplicate Activity items.';

commit;
