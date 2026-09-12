begin;

-- ============================================================
-- SIGNAL
-- Migration 0018
-- Authenticated Signal withdrawal authority + safe re-entry
-- ============================================================
--
-- Browser contract:
--
--   Browser
--     -> withdraw_my_signal(p_signal_intent_id)
--     -> auth.uid()
--     -> caller-owned assigned Signal intent
--     -> caller's matched/confirmed membership
--     -> authoritative Signal group + grouping policy
--
-- The browser never supplies a trusted user UUID.
--
-- Withdrawal is permitted only while a Signal is:
--
--   forming
--   confirming
--   coordinating
--
-- Locked and later lifecycle states use separate departure
-- semantics and are intentionally rejected here.
--
-- Withdrawal atomically:
--
--   1. marks the caller's Signal intent withdrawn
--   2. marks the caller's membership withdrawn
--   3. clears active-core authority
--   4. records ended_at
--   5. recounts matched/confirmed members
--   6. reopens confirming/coordinating groups to forming when
--      remaining membership falls below activation threshold
--
-- Safe re-entry:
--
-- signal_group_memberships intentionally has one durable row per
-- (signal_group_id, user_id). The formation engine previously used
-- ON CONFLICT DO NOTHING, which would strand a returning user behind
-- a terminal membership row.
--
-- A narrow BEFORE INSERT trigger reactivates an existing terminal
-- membership row when formation legitimately inserts that same user
-- into that same group again.
--
-- This preserves membership identity/history without deleting rows
-- or weakening the unique group/user invariant.
-- ============================================================


-- ============================================================
-- 1. SAFE MEMBERSHIP RE-ENTRY
-- ============================================================

create or replace function public.reactivate_signal_membership_on_reentry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
begin
  select sgm.id
  into v_existing_id
  from public.signal_group_memberships sgm
  where
    sgm.signal_group_id = new.signal_group_id
    and sgm.user_id = new.user_id
    and sgm.state in (
      'declined'::public.signal_group_membership_state,
      'timed_out'::public.signal_group_membership_state,
      'withdrawn'::public.signal_group_membership_state,
      'replaced'::public.signal_group_membership_state
    )
  for update;

  if v_existing_id is null then
    return new;
  end if;

  update public.signal_group_memberships
  set
    originating_signal_intent_id =
      new.originating_signal_intent_id,
    state =
      'matched'::public.signal_group_membership_state,
    is_active_core = false,
    matched_at = new.matched_at,
    confirmation_deadline = null,
    confirmed_at = null,
    ended_at = null,
    replacement_reason = null,
    updated_at = now()
  where id = v_existing_id;

  -- The durable existing membership row has been reactivated.
  -- Suppress the incoming INSERT so the unique group/user invariant
  -- remains intact.
  return null;
end;
$$;

alter function public.reactivate_signal_membership_on_reentry()
  owner to postgres;

revoke all
on function public.reactivate_signal_membership_on_reentry()
from public;

revoke all
on function public.reactivate_signal_membership_on_reentry()
from anon;

revoke all
on function public.reactivate_signal_membership_on_reentry()
from authenticated;


drop trigger if exists
  signal_group_memberships_reactivate_on_reentry
on public.signal_group_memberships;

create trigger
  signal_group_memberships_reactivate_on_reentry
before insert
on public.signal_group_memberships
for each row
execute function public.reactivate_signal_membership_on_reentry();


-- ============================================================
-- 2. AUTHENTICATED WITHDRAWAL RPC
-- ============================================================

create or replace function public.withdraw_my_signal(
  p_signal_intent_id uuid
)
returns table (
  signal_intent_id uuid,
  signal_group_id uuid,
  group_state public.signal_group_state,
  remaining_member_count integer,
  activation_threshold integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_now timestamptz := now();

  v_intent_id uuid;
  v_group_id uuid;
  v_membership_id uuid;

  v_group_state public.signal_group_state;
  v_remaining_member_count integer;
  v_activation_threshold integer;
begin
  -- ----------------------------------------------------------
  -- Authenticated identity is authoritative.
  -- ----------------------------------------------------------

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_signal_intent_id is null then
    raise exception 'signal_intent_id_required';
  end if;


  -- ----------------------------------------------------------
  -- Lock caller-owned live assignment.
  --
  -- The caller cannot withdraw another user's Signal intent.
  -- ----------------------------------------------------------

  select
    si.id,
    sgm.id,
    sgm.signal_group_id
  into
    v_intent_id,
    v_membership_id,
    v_group_id
  from public.signal_intents si
  join public.signal_group_memberships sgm
    on sgm.originating_signal_intent_id = si.id
   and sgm.user_id = si.user_id
  where
    si.id = p_signal_intent_id
    and si.user_id = v_user_id
    and si.state =
      'assigned'::public.signal_intent_state
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    )
  for update of si, sgm;

  if v_intent_id is null
     or v_membership_id is null
     or v_group_id is null then
    raise exception 'live_signal_assignment_not_found';
  end if;


  -- ----------------------------------------------------------
  -- Lock authoritative group and read its exact threshold.
  -- ----------------------------------------------------------

  select
    sg.state,
    gp.activation_threshold
  into
    v_group_state,
    v_activation_threshold
  from public.signal_groups sg
  join public.grouping_policies gp
    on gp.id = sg.grouping_policy_id
  where sg.id = v_group_id
  for update of sg;

  if v_group_state is null then
    raise exception 'signal_group_not_found';
  end if;

  if v_activation_threshold is null
     or v_activation_threshold <= 0 then
    raise exception 'signal_activation_threshold_invalid';
  end if;


  -- ----------------------------------------------------------
  -- Withdrawal lifecycle boundary.
  -- ----------------------------------------------------------

  if v_group_state not in (
    'forming'::public.signal_group_state,
    'confirming'::public.signal_group_state,
    'coordinating'::public.signal_group_state
  ) then
    raise exception
      'signal_withdrawal_not_allowed_in_state: %',
      v_group_state;
  end if;


  -- ----------------------------------------------------------
  -- Withdraw membership first.
  --
  -- is_active_core must be false whenever membership is not
  -- confirmed, per the existing table constraint.
  -- ----------------------------------------------------------

  update public.signal_group_memberships
  set
    state =
      'withdrawn'::public.signal_group_membership_state,
    is_active_core = false,
    ended_at = v_now,
    replacement_reason = 'user_withdrew',
    updated_at = v_now
  where id = v_membership_id;


  -- ----------------------------------------------------------
  -- Withdraw the caller's intent.
  -- ----------------------------------------------------------

  update public.signal_intents
  set
    state =
      'withdrawn'::public.signal_intent_state,
    updated_at = v_now
  where id = v_intent_id;


  -- ----------------------------------------------------------
  -- Recount authoritative current members.
  -- ----------------------------------------------------------

  select count(*)::integer
  into v_remaining_member_count
  from public.signal_group_memberships sgm
  where
    sgm.signal_group_id = v_group_id
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    );


  -- ----------------------------------------------------------
  -- Reopen when critical mass has been lost.
  --
  -- FORMING already represents the correct state.
  --
  -- CONFIRMING / COORDINATING must return to FORMING when
  -- remaining live membership falls below this group's own
  -- activation threshold.
  --
  -- Clear phase-specific deadlines so a future threshold crossing
  -- starts a fresh authoritative lifecycle window.
  -- ----------------------------------------------------------

  if
    v_remaining_member_count < v_activation_threshold
    and v_group_state in (
      'confirming'::public.signal_group_state,
      'coordinating'::public.signal_group_state
    )
  then
    update public.signal_groups
    set
      state = 'forming'::public.signal_group_state,
      confirmation_deadline = null,
      coordination_deadline = null,
      updated_at = v_now
    where id = v_group_id;

    v_group_state :=
      'forming'::public.signal_group_state;
  else
    select sg.state
    into v_group_state
    from public.signal_groups sg
    where sg.id = v_group_id;
  end if;


  return query
  select
    v_intent_id,
    v_group_id,
    v_group_state,
    v_remaining_member_count,
    v_activation_threshold;
end;
$$;


-- ============================================================
-- 3. EXECUTION SECURITY
-- ============================================================

alter function public.withdraw_my_signal(uuid)
  owner to postgres;

revoke all
on function public.withdraw_my_signal(uuid)
from public;

revoke all
on function public.withdraw_my_signal(uuid)
from anon;

grant execute
on function public.withdraw_my_signal(uuid)
to authenticated;


comment on function public.withdraw_my_signal(uuid)
is
'Withdraws auth.uid() from their own matched/confirmed Signal while the group is forming, confirming, or coordinating. The caller supplies only their Signal intent ID, never a trusted user ID. Membership and intent are withdrawn atomically; active-core authority is removed; matched/confirmed membership is recounted; confirming/coordinating groups reopen to forming when critical mass is lost. Locked and later lifecycle states are intentionally rejected.';


comment on function public.reactivate_signal_membership_on_reentry()
is
'Internal formation safeguard. When a legitimate insert targets an existing terminal membership for the same Signal group and user, reactivates that durable row as matched and suppresses the conflicting insert. This preserves the unique group/user invariant while allowing safe Signal re-entry.';


commit;
