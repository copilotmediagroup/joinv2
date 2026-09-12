begin;

-- SIGNAL confirmation authority forward repair.
--
-- 0023 introduced reconcile_signal_confirmation_window(uuid).
-- Runtime behavior testing exposed PostgreSQL 42702 because the
-- RETURNS TABLE output variable signal_group_id collided with an
-- unqualified signal_group_memberships.signal_group_id reference.
--
-- This migration changes only that SQL qualification. Lifecycle,
-- timeout, rematch, threshold, ownership, and authorization semantics
-- remain unchanged.

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

commit;
