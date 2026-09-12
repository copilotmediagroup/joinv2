begin;

-- ============================================================
-- AUTHENTICATED SIGNAL CONFIRMATION AUTHORITY
--
-- Purpose:
--   Authoritative STILL DOWN confirmation and confirmation-window
--   reconciliation for an authenticated Signal participant.
--
-- Lifecycle contract:
--
--   FORMING
--     -> threshold reached by formation engine
--     -> CONFIRMING with authoritative 5-minute deadline
--
--   CONFIRMING
--     -> each matched member may explicitly confirm
--     -> confirmation atomically sets:
--          state = confirmed
--          is_active_core = true
--          confirmed_at = authoritative database time
--
--   While the confirmation deadline remains open:
--     -> pending matched members retain their STILL DOWN opportunity
--     -> reaching activation threshold alone does NOT prematurely
--        remove those pending members
--     -> if no matched members remain and confirmed active-core count
--        is at least activation threshold, the group may advance early
--        to COORDINATING
--
--   At/after confirmation deadline:
--     -> remaining matched memberships are timed_out
--     -> still-live assigned Signal intents return to active for rematching
--     -> genuinely expired Signal intents become expired
--     -> if confirmed active-core count >= activation threshold:
--          group -> COORDINATING
--     -> otherwise:
--          group -> FORMING
--          surviving confirmed members remain confirmed active-core
--          timed-out users are released
--
-- Important:
--   * auth.uid() is the only browser user identity authority.
--   * confirmation is addressed through the caller-owned assigned
--     Signal intent, matching the existing withdrawal authority.
--   * group rows serialize lifecycle reconciliation.
--   * confirmation + active-core assignment are atomic.
--   * no coordination duration is invented here.
--   * coordination_deadline remains NULL until authoritative
--     coordination-domain logic owns that deadline.
--   * no venue/time winner is created here.
--   * no group is locked here.
-- ============================================================


-- ============================================================
-- 1. INTERNAL CONFIRMATION-WINDOW RECONCILIATION
--
-- Not executable by browser roles.
--
-- Caller must already hold the target signal_groups row lock.
-- ============================================================

create or replace function public.reconcile_signal_confirmation_window(
  p_signal_group_id uuid
)
returns table (
  signal_group_id uuid,
  group_state public.signal_group_state,
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
  v_now timestamptz := clock_timestamp();

  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;

  v_matched_member_count integer;
  v_confirmed_active_core_count integer;
begin
  if p_signal_group_id is null then
    raise exception 'signal_group_id_required'
      using errcode = '22023';
  end if;

  select sg.*
  into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id;

  if not found then
    raise exception 'signal_group_not_found'
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

  if v_group.state = 'confirming' then
    if v_group.confirmation_deadline is null then
      raise exception 'signal_confirmation_deadline_missing'
        using errcode = 'P0001';
    end if;

    -- --------------------------------------------------------
    -- Deadline reconciliation.
    --
    -- Every still-matched member has failed to answer STILL DOWN
    -- within the authoritative confirmation window.
    -- --------------------------------------------------------

    if v_group.confirmation_deadline <= v_now then

      update public.signal_intents si
      set
        state = case
          when si.expires_at > v_now
            then 'active'::public.signal_intent_state
          else 'expired'::public.signal_intent_state
        end,
        updated_at = v_now
      where si.id in (
        select sgm.originating_signal_intent_id
        from public.signal_group_memberships sgm
        where sgm.signal_group_id = v_group.id
          and sgm.state = 'matched'
          and sgm.originating_signal_intent_id is not null
      )
      and si.state = 'assigned';

      update public.signal_group_memberships as sgm_timeout
      set
        state = 'timed_out',
        is_active_core = false,
        ended_at = v_now,
        replacement_reason = 'confirmation_timeout',
        updated_at = v_now
      where sgm_timeout.signal_group_id = v_group.id
        and sgm_timeout.state = 'matched';

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

    -- --------------------------------------------------------
    -- Advance only when no current matched member is still owed
    -- an open STILL DOWN opportunity.
    --
    -- This is true either:
    --   * everyone answered before the deadline, or
    --   * deadline reconciliation timed out the nonresponders.
    -- --------------------------------------------------------

    if v_matched_member_count = 0 then

      if v_confirmed_active_core_count >=
         v_policy.activation_threshold then

        update public.signal_groups
        set
          state = 'coordinating',
          confirmation_deadline = null,
          coordination_deadline = null,
          updated_at = v_now
        where id = v_group.id
          and state = 'confirming'
        returning *
        into v_group;

      elsif v_group.confirmation_deadline <= v_now then

        update public.signal_groups
        set
          state = 'forming',
          confirmation_deadline = null,
          coordination_deadline = null,
          updated_at = v_now
        where id = v_group.id
          and state = 'confirming'
        returning *
        into v_group;

      end if;

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
    v_group.id,
    v_group.state,
    v_matched_member_count,
    v_confirmed_active_core_count,
    v_policy.activation_threshold,
    v_group.confirmation_deadline,
    v_group.coordination_deadline;
end;
$function$;

alter function public.reconcile_signal_confirmation_window(uuid)
  owner to postgres;

revoke all
  on function public.reconcile_signal_confirmation_window(uuid)
  from public;

revoke all
  on function public.reconcile_signal_confirmation_window(uuid)
  from anon;

revoke all
  on function public.reconcile_signal_confirmation_window(uuid)
  from authenticated;


-- ============================================================
-- 2. AUTHENTICATED STILL DOWN CONFIRMATION
--
-- Browser supplies its own Signal intent id.
-- auth.uid() proves ownership.
-- ============================================================

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
  -- Lock caller-owned assigned intent + durable membership.
  --
  -- This prevents a browser from confirming another user's
  -- membership by knowing a Signal group UUID.
  -- ----------------------------------------------------------

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

  select sgm.*
  into v_membership
  from public.signal_group_memberships sgm
  where sgm.originating_signal_intent_id = v_intent.id
    and sgm.user_id = v_user_id
    and sgm.state in ('matched', 'confirmed')
  for update;

  if not found then
    raise exception 'live_signal_membership_not_found'
      using errcode = 'P0001';
  end if;

  -- ----------------------------------------------------------
  -- Serialize lifecycle transition on the authoritative group.
  -- ----------------------------------------------------------

  select sg.*
  into v_group
  from public.signal_groups sg
  where sg.id = v_membership.signal_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found'
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
