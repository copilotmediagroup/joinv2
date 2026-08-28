-- ============================================================
-- SIGNAL
-- G4.14-B1
--
-- Atomic Signal -> Plan conversion.
--
-- Contract:
--   * one Signal group -> at most one Plan
--   * Signal must be locked and unexpired
--   * activation threshold must still be satisfied
--   * only confirmed active-core members convert
--   * venue decision must be finalized
--   * time decision must be finalized
--   * winning venue/time are authoritative DB values
--   * Signal Plans have no human creator
--   * converted members enter through signal_lock
--   * repeat calls are idempotent
-- ============================================================

create or replace function public.convert_locked_signal_group_to_plan(
  p_signal_group_id uuid
)
returns table (
  plan_id uuid,
  created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;

  v_existing_plan_id uuid;
  v_plan_id uuid;

  v_member_count integer;

  v_venue_decision_id uuid;
  v_venue_option_id uuid;
  v_venue_id uuid;

  v_time_decision_id uuid;
  v_time_option_id uuid;
  v_scheduled_starts_at timestamptz;

  v_conversion_at timestamptz := clock_timestamp();
begin
  if p_signal_group_id is null then
    raise exception
      'signal_group_id is required';
  end if;

  -- ----------------------------------------------------------
  -- Serialize conversion for this Signal group.
  -- ----------------------------------------------------------

  select sg.*
  into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;

  if not found then
    raise exception
      'signal_group_not_found: %',
      p_signal_group_id;
  end if;

  -- ----------------------------------------------------------
  -- Idempotency.
  --
  -- A successful prior conversion wins immediately.
  -- This intentionally happens before lifecycle revalidation so
  -- refresh/retry/reconnect can always recover the authoritative
  -- Plan after conversion.
  -- ----------------------------------------------------------

  select p.id
  into v_existing_plan_id
  from public.plans p
  where p.originating_signal_group_id = p_signal_group_id;

  if v_existing_plan_id is not null then
    return query
    select
      v_existing_plan_id,
      false;

    return;
  end if;

  -- ----------------------------------------------------------
  -- Signal lifecycle validation.
  -- ----------------------------------------------------------

  if v_group.state <> 'locked' then
    raise exception
      'signal_group_not_locked: group=% state=%',
      p_signal_group_id,
      v_group.state;
  end if;

  if v_group.locked_at is null then
    raise exception
      'signal_group_locked_at_missing: %',
      p_signal_group_id;
  end if;

  if v_group.expires_at <= v_conversion_at then
    raise exception
      'signal_group_expired: %',
      p_signal_group_id;
  end if;

  -- ----------------------------------------------------------
  -- Grouping policy + threshold revalidation.
  -- ----------------------------------------------------------

  select gp.*
  into v_policy
  from public.grouping_policies gp
  where gp.id = v_group.grouping_policy_id;

  if not found then
    raise exception
      'grouping_policy_not_found: %',
      v_group.grouping_policy_id;
  end if;

  select count(*)::integer
  into v_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = p_signal_group_id
    and sgm.state = 'confirmed'
    and sgm.is_active_core = true;

  if v_member_count < v_policy.activation_threshold then
    raise exception
      'signal_threshold_not_met: group=% confirmed_active_core=% required=%',
      p_signal_group_id,
      v_member_count,
      v_policy.activation_threshold;
  end if;

  if v_member_count > v_policy.max_capacity then
    raise exception
      'signal_group_over_max_capacity: group=% confirmed_active_core=% max=%',
      p_signal_group_id,
      v_member_count,
      v_policy.max_capacity;
  end if;

  -- ----------------------------------------------------------
  -- Resolve authoritative finalized venue decision.
  --
  -- winning_option_id alone is not trusted. The winning option
  -- must belong to a round belonging to the same decision, and
  -- the venue candidate must belong to this Signal group.
  -- ----------------------------------------------------------

  select
    d.id,
    o.id,
    vc.venue_id
  into
    v_venue_decision_id,
    v_venue_option_id,
    v_venue_id
  from public.group_decisions d
  join public.decision_options o
    on o.id = d.winning_option_id
  join public.decision_rounds r
    on r.id = o.round_id
   and r.decision_id = d.id
  join public.venue_candidates vc
    on vc.id = o.venue_candidate_id
  join public.venues v
    on v.id = vc.venue_id
  where d.signal_group_id = p_signal_group_id
    and d.plan_id is null
    and d.type = 'venue_selection'
    and d.state = 'finalized'
    and d.finalized_at is not null
    and d.winning_option_id is not null
    and vc.signal_group_id = p_signal_group_id
    and vc.plan_id is null
    and vc.is_active = true
    and v.is_active = true
    and v.city_id = v_group.city_id
  order by
    d.finalized_at desc,
    d.created_at desc,
    d.id desc
  limit 1;

  if v_venue_decision_id is null
     or v_venue_option_id is null
     or v_venue_id is null then
    raise exception
      'finalized_signal_venue_not_found: %',
      p_signal_group_id;
  end if;

  -- ----------------------------------------------------------
  -- Resolve authoritative finalized time decision.
  -- ----------------------------------------------------------

  select
    d.id,
    o.id,
    o.proposed_time
  into
    v_time_decision_id,
    v_time_option_id,
    v_scheduled_starts_at
  from public.group_decisions d
  join public.decision_options o
    on o.id = d.winning_option_id
  join public.decision_rounds r
    on r.id = o.round_id
   and r.decision_id = d.id
  where d.signal_group_id = p_signal_group_id
    and d.plan_id is null
    and d.type = 'time_selection'
    and d.state = 'finalized'
    and d.finalized_at is not null
    and d.winning_option_id is not null
    and o.proposed_time is not null
  order by
    d.finalized_at desc,
    d.created_at desc,
    d.id desc
  limit 1;

  if v_time_decision_id is null
     or v_time_option_id is null
     or v_scheduled_starts_at is null then
    raise exception
      'finalized_signal_time_not_found: %',
      p_signal_group_id;
  end if;

  if v_scheduled_starts_at <= v_conversion_at then
    raise exception
      'signal_time_already_passed: group=% scheduled_starts_at=%',
      p_signal_group_id,
      v_scheduled_starts_at;
  end if;

  -- ----------------------------------------------------------
  -- Create the authoritative Signal Plan.
  --
  -- target_capacity is the comfortable Plan capacity.
  -- group_vote is required because Signal Plans have no creator.
  --
  -- The existing unique constraint on
  -- plans.originating_signal_group_id is the final concurrency
  -- guard even if another writer bypasses this function.
  -- ----------------------------------------------------------

  insert into public.plans (
    origin,
    creator_user_id,
    originating_signal_group_id,
    city_id,
    activity_id,
    capacity,
    crowd_mode,
    min_age,
    max_age,
    admission_mode,
    state,
    current_venue_id,
    scheduled_starts_at,
    scheduled_ends_at,
    published_at,
    locked_at
  )
  values (
    'signal',
    null,
    p_signal_group_id,
    v_group.city_id,
    v_group.activity_id,
    v_policy.target_capacity,
    v_group.crowd_mode,
    v_group.min_age,
    v_group.max_age,
    'group_vote',
    'locked',
    v_venue_id,
    v_scheduled_starts_at,
    null,
    v_conversion_at,
    v_conversion_at
  )
  on conflict (originating_signal_group_id)
  do nothing
  returning id
  into v_plan_id;

  -- A direct/concurrent writer may have won the unique race.
  -- Recover the already-created authoritative Plan instead of
  -- manufacturing a second one.
  if v_plan_id is null then
    select p.id
    into v_existing_plan_id
    from public.plans p
    where p.originating_signal_group_id = p_signal_group_id;

    if v_existing_plan_id is null then
      raise exception
        'signal_plan_conversion_conflict_without_plan: %',
        p_signal_group_id;
    end if;

    return query
    select
      v_existing_plan_id,
      false;

    return;
  end if;

  -- ----------------------------------------------------------
  -- Copy only authoritative locked Signal membership.
  -- ----------------------------------------------------------

  insert into public.plan_memberships (
    plan_id,
    user_id,
    membership_state,
    admission_origin,
    joined_at,
    locked_member
  )
  select
    v_plan_id,
    sgm.user_id,
    'active',
    'signal_lock',
    v_conversion_at,
    true
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = p_signal_group_id
    and sgm.state = 'confirmed'
    and sgm.is_active_core = true
  order by sgm.confirmed_at nulls last, sgm.created_at, sgm.id;

  if (
    select count(*)
    from public.plan_memberships pm
    where pm.plan_id = v_plan_id
      and pm.membership_state = 'active'
      and pm.admission_origin = 'signal_lock'
  ) <> v_member_count then
    raise exception
      'signal_plan_membership_copy_mismatch: group=% expected=%',
      p_signal_group_id,
      v_member_count;
  end if;

  -- ----------------------------------------------------------
  -- Immutable Plan history.
  -- ----------------------------------------------------------

  insert into public.plan_history (
    plan_id,
    event_type,
    actor_user_id,
    related_decision_id,
    new_venue_id,
    new_starts_at,
    reason,
    metadata,
    occurred_at
  )
  values (
    v_plan_id,
    'created',
    null,
    null,
    v_venue_id,
    v_scheduled_starts_at,
    'Converted atomically from locked Signal group',
    jsonb_build_object(
      'origin', 'signal',
      'signal_group_id', p_signal_group_id,
      'venue_decision_id', v_venue_decision_id,
      'venue_option_id', v_venue_option_id,
      'time_decision_id', v_time_decision_id,
      'time_option_id', v_time_option_id,
      'member_count', v_member_count,
      'activation_threshold', v_policy.activation_threshold,
      'target_capacity', v_policy.target_capacity,
      'max_capacity', v_policy.max_capacity
    ),
    v_conversion_at
  );

  insert into public.plan_history (
    plan_id,
    event_type,
    actor_user_id,
    related_decision_id,
    new_venue_id,
    new_starts_at,
    reason,
    metadata,
    occurred_at
  )
  values (
    v_plan_id,
    'locked',
    null,
    v_time_decision_id,
    v_venue_id,
    v_scheduled_starts_at,
    'Signal venue and time finalized',
    jsonb_build_object(
      'signal_group_id', p_signal_group_id,
      'venue_decision_id', v_venue_decision_id,
      'time_decision_id', v_time_decision_id
    ),
    v_conversion_at
  );

  return query
  select
    v_plan_id,
    true;
end;
$$;

comment on function public.convert_locked_signal_group_to_plan(uuid)
is
  'Atomically and idempotently converts one locked Signal group with finalized venue/time decisions into exactly one Signal-origin Plan.';

