begin;

-- SIGNAL confirmation canonical lock-order repair.
--
-- 0025 made reconcile_signal_confirmation_window(uuid)
-- serialize on the Signal group before mutating intents,
-- memberships, or group lifecycle state.
--
-- confirm_my_signal_membership(uuid) previously locked:
--
--   intent -> membership -> group
--
-- That order can invert against direct reconciliation:
--
--   group -> intent/membership mutations
--
-- This forward-only migration makes confirmation use:
--
--   nonlocking ownership discovery
--   -> group FOR UPDATE
--   -> intent FOR UPDATE
--   -> membership FOR UPDATE
--   -> revalidation
--   -> mutation/reconciliation
--
-- Lifecycle, authorization, threshold, timeout, idempotency,
-- and return contracts remain unchanged.

create or replace function public.confirm_my_signal_membership(
  p_signal_intent_id uuid
)
returns table (
  signal_intent_id uuid,
  signal_group_id uuid,
  group_state public.signal_group_state,
  membership_id uuid,
  membership_state public.signal_group_membership_state,
  is_active_core boolean,
  confirmed_at timestamptz,
  matched_member_count integer,
  confirmed_active_core_count integer,
  activation_threshold integer,
  confirmation_deadline timestamptz,
  coordination_deadline timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();

  v_intent public.signal_intents%rowtype;
  v_group public.signal_groups%rowtype;
  v_membership public.signal_group_memberships%rowtype;
  v_policy public.grouping_policies%rowtype;

  v_discovered_group_id uuid;
  v_discovered_membership_id uuid;

  v_matched_member_count integer;
  v_confirmed_active_core_count integer;
begin
  -- ----------------------------------------------------------
  -- Authentication
  -- ----------------------------------------------------------

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_signal_intent_id is null then
    raise exception 'signal_intent_id_required'
      using errcode = '22023';
  end if;

  -- ----------------------------------------------------------
  -- Canonical confirmation lock order.
  --
  -- Discovery reads intentionally acquire no row locks.
  -- They identify the caller-owned durable membership and group
  -- before any mutable row is locked.
  --
  -- Authoritative order:
  --
  --   1. Signal group
  --   2. Signal intent
  --   3. Signal group membership
  --
  -- reconcile_signal_confirmation_window(uuid) already locks the
  -- Signal group before mutating intents and memberships. Using
  -- the same order here removes the group/intent lock inversion.
  -- ----------------------------------------------------------

  select si.*
  into v_intent
  from public.signal_intents si
  where si.id = p_signal_intent_id
    and si.user_id = v_user_id
    and si.state = 'assigned';

  if not found then
    raise exception 'live_signal_assignment_not_found'
      using errcode = 'P0001';
  end if;

  select
    sgm.id,
    sgm.signal_group_id
  into
    v_discovered_membership_id,
    v_discovered_group_id
  from public.signal_group_memberships sgm
  where sgm.originating_signal_intent_id = v_intent.id
    and sgm.user_id = v_user_id
    and sgm.state in ('matched', 'confirmed');

  if not found then
    raise exception 'live_signal_membership_not_found'
      using errcode = 'P0001';
  end if;

  -- Lock 1: group.
  select sg.*
  into v_group
  from public.signal_groups sg
  where sg.id = v_discovered_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found'
      using errcode = 'P0001';
  end if;

  -- Lock 2: intent.
  --
  -- Revalidate after waiting on the group lock because deadline
  -- reconciliation may have changed this intent meanwhile.
  select si.*
  into v_intent
  from public.signal_intents si
  where si.id = p_signal_intent_id
    and si.user_id = v_user_id
    and si.state = 'assigned'
  for update;

  if not found then
    raise exception 'live_signal_assignment_not_found'
      using errcode = 'P0001';
  end if;

  -- Lock 3: durable membership.
  --
  -- Revalidate identity, ownership, group, originating intent,
  -- and live confirmation state after group + intent are locked.
  select sgm.*
  into v_membership
  from public.signal_group_memberships sgm
  where sgm.id = v_discovered_membership_id
    and sgm.signal_group_id = v_group.id
    and sgm.originating_signal_intent_id = v_intent.id
    and sgm.user_id = v_user_id
    and sgm.state in ('matched', 'confirmed')
  for update;

  if not found then
    raise exception 'live_signal_membership_not_found'
      using errcode = 'P0001';
  end if;

  if v_group.expires_at <= v_now then
    raise exception 'signal_group_expired'
      using errcode = 'P0001';
  end if;

  select gp.*
  into v_policy
  from public.grouping_policies gp
  where gp.id = v_group.grouping_policy_id;

  if not found then
    raise exception 'signal_group_policy_not_found'
      using errcode = 'P0001';
  end if;

  if v_policy.activation_threshold is null
     or v_policy.activation_threshold < 1 then
    raise exception 'invalid_signal_activation_threshold'
      using errcode = 'P0001';
  end if;

  -- ----------------------------------------------------------
  -- Idempotent success.
  --
  -- A confirmed caller may retry while the group has already
  -- advanced to coordinating. No second mutation occurs.
  -- ----------------------------------------------------------

  if v_membership.state = 'confirmed' then

    if not v_membership.is_active_core then
      raise exception 'confirmed_signal_membership_not_active_core'
        using errcode = 'P0001';
    end if;

    if v_membership.confirmed_at is null then
      raise exception 'confirmed_signal_membership_timestamp_missing'
        using errcode = 'P0001';
    end if;

    if v_group.state not in ('confirming', 'coordinating') then
      raise exception
        'confirmed_signal_membership_invalid_group_state: %',
        v_group.state
        using errcode = 'P0001';
    end if;

  else

    if v_group.state <> 'confirming' then
      raise exception
        'signal_group_not_confirming: group=% state=%',
        v_group.id,
        v_group.state
        using errcode = 'P0001';
    end if;

    if v_group.confirmation_deadline is null then
      raise exception 'signal_confirmation_deadline_missing'
        using errcode = 'P0001';
    end if;

    if v_group.confirmation_deadline <= v_now then
      -- The confirmation window is closed.
      --
      -- Reconcile and RETURN the authoritative timeout result.
      -- Do not raise afterward: an exception would roll back the
      -- reconciliation performed in this same transaction.
      perform *
      from public.reconcile_signal_confirmation_window(v_group.id);

      select sg.*
      into v_group
      from public.signal_groups sg
      where sg.id = v_group.id;

      select sgm.*
      into v_membership
      from public.signal_group_memberships sgm
      where sgm.id = v_membership.id;

      if not found then
        raise exception 'signal_membership_disappeared_after_reconciliation'
          using errcode = 'P0001';
      end if;

    else

      update public.signal_group_memberships
      set
        state = 'confirmed',
        is_active_core = true,
        confirmed_at = v_now,
        updated_at = v_now
      where id = v_membership.id
        and state = 'matched'
      returning *
      into v_membership;

      if not found then
        raise exception 'signal_membership_confirmation_race'
          using errcode = 'P0001';
      end if;

      -- Reconcile immediately.
      --
      -- If this was the last pending matched member and threshold is
      -- satisfied, the group may advance before the five-minute timer.
      perform *
      from public.reconcile_signal_confirmation_window(v_group.id);

      select sg.*
      into v_group
      from public.signal_groups sg
      where sg.id = v_group.id;

    end if;

  end if;

  select count(*)::integer
  into v_matched_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'matched';

  select count(*)::integer
  into v_confirmed_active_core_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'
    and sgm.is_active_core = true;

  return query
  select
    v_intent.id,
    v_group.id,
    v_group.state,
    v_membership.id,
    v_membership.state,
    v_membership.is_active_core,
    v_membership.confirmed_at,
    v_matched_member_count,
    v_confirmed_active_core_count,
    v_policy.activation_threshold,
    v_group.confirmation_deadline,
    v_group.coordination_deadline;
end;
$function$;

alter function public.confirm_my_signal_membership(uuid)
  owner to postgres;

revoke all
  on function public.confirm_my_signal_membership(uuid)
  from public;

revoke all
  on function public.confirm_my_signal_membership(uuid)
  from anon;

grant execute
  on function public.confirm_my_signal_membership(uuid)
  to authenticated;

commit;
