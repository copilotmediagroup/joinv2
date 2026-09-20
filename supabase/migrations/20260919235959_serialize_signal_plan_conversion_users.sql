begin;

create or replace function public.convert_locked_signal_group_to_plan(
  p_signal_group_id uuid
)
returns table (
  plan_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;
  v_existing_plan_id uuid;
  v_plan_id uuid;
  v_conversation_id uuid;
  v_member_count integer;

  v_venue_round_id uuid;
  v_venue_option_id uuid;
  v_venue_place_id text;
  v_venue_payload jsonb;
  v_venue_name text;
  v_venue_address text;
  v_venue_lat numeric;
  v_venue_lng numeric;
  v_venue_id uuid;

  v_time_round_id uuid;
  v_time_option_id uuid;
  v_scheduled_starts_at timestamptz;
  v_scheduled_ends_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_signal_group_id is null then
    raise exception 'signal_group_id_required' using errcode = '22023';
  end if;

  -- One group row serializes conversion and all lifecycle checks.
  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found' using errcode = 'P0001';
  end if;

  -- Caller must belong to the exact active locked cohort.
  perform 1
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.user_id = v_user_id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  if not found then
    raise exception 'signal_conversion_membership_required' using errcode = '42501';
  end if;

  -- Idempotent reconnect/retry recovery.
  select p.id into v_existing_plan_id
  from public.plans p
  where p.originating_signal_group_id = v_group.id;

  if v_existing_plan_id is not null then
    return query select v_existing_plan_id, false;
    return;
  end if;

  if v_group.state <> 'locked'::public.signal_group_state then
    raise exception 'signal_group_not_locked: %', v_group.state using errcode = 'P0001';
  end if;

  if v_group.locked_at is null then
    raise exception 'signal_group_locked_at_missing' using errcode = 'P0001';
  end if;

  if v_group.expires_at <= v_now then
    raise exception 'signal_group_expired' using errcode = 'P0001';
  end if;

  select gp.* into v_policy
  from public.grouping_policies gp
  where gp.id = v_group.grouping_policy_id;

  if not found
     or v_policy.activation_threshold is null
     or v_policy.activation_threshold < 1
     or v_policy.max_capacity is null
     or v_policy.max_capacity < v_policy.activation_threshold
     or v_policy.target_capacity is null
     or v_policy.target_capacity < v_policy.activation_threshold then
    raise exception 'invalid_signal_grouping_policy' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true;

  if v_member_count < v_policy.activation_threshold then
    raise exception 'signal_threshold_not_met' using errcode = 'P0001';
  end if;

  if v_member_count > v_policy.max_capacity then
    raise exception 'signal_group_over_max_capacity' using errcode = 'P0001';
  end if;

  -- Authoritative won venue from 0030.
  select
    svr.id,
    svo.id,
    svo.place_id,
    svo.payload
  into
    v_venue_round_id,
    v_venue_option_id,
    v_venue_place_id,
    v_venue_payload
  from public.signal_venue_rounds svr
  join public.signal_venue_options svo
    on svo.round_id = svr.id
   and svo.id = svr.winner_option_id
  where svr.signal_group_id = v_group.id
    and svr.state = 'won'
    and svr.winner_option_id is not null
  order by svr.round_number desc
  limit 1;

  if v_venue_round_id is null or v_venue_option_id is null then
    raise exception 'authoritative_signal_venue_not_found' using errcode = 'P0001';
  end if;

  v_venue_name := nullif(btrim(v_venue_payload->>'name'), '');
  v_venue_address := nullif(btrim(v_venue_payload->>'address'), '');
  v_venue_lat := nullif(v_venue_payload->>'lat', '')::numeric;
  v_venue_lng := nullif(v_venue_payload->>'lng', '')::numeric;

  if nullif(btrim(v_venue_place_id), '') is null or v_venue_name is null then
    raise exception 'authoritative_signal_venue_payload_invalid' using errcode = 'P0001';
  end if;

  insert into public.venues (
    city_id,
    category_id,
    name,
    address_line1,
    latitude,
    longitude,
    is_active,
    external_source,
    external_place_id,
    created_at,
    updated_at
  ) values (
    v_group.city_id,
    null,
    v_venue_name,
    v_venue_address,
    v_venue_lat,
    v_venue_lng,
    true,
    'google',
    v_venue_place_id,
    v_now,
    v_now
  )
  on conflict (external_source, external_place_id)
  do update set
    city_id = excluded.city_id,
    name = excluded.name,
    address_line1 = excluded.address_line1,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    is_active = true,
    updated_at = excluded.updated_at
  returning id into v_venue_id;

  -- Authoritative winning time from 0031.
  select
    str.id,
    sto.id,
    sto.starts_at
  into
    v_time_round_id,
    v_time_option_id,
    v_scheduled_starts_at
  from public.signal_time_rounds str
  join public.signal_time_options sto
    on sto.round_id = str.id
   and sto.id = str.winner_option_id
  where str.signal_group_id = v_group.id
    and str.state = 'won'
    and str.winner_option_id is not null
  limit 1;

  if v_time_round_id is null
     or v_time_option_id is null
     or v_scheduled_starts_at is null then
    raise exception 'authoritative_signal_time_not_found' using errcode = 'P0001';
  end if;

  if v_scheduled_starts_at <= v_now then
    raise exception 'signal_time_already_passed' using errcode = 'P0001';
  end if;

  v_scheduled_ends_at := v_scheduled_starts_at + interval '90 minutes';

  insert into public.plans (
    origin,
    creator_user_id,
    originating_signal_group_id,
    city_id,
    activity_id,
    title,
    description,
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
    locked_at,
    created_at,
    updated_at
  ) values (
    'signal',
    null,
    v_group.id,
    v_group.city_id,
    v_group.activity_id,
    v_venue_name,
    'Created automatically from a locked SIGNAL.',
    v_policy.target_capacity,
    v_group.crowd_mode,
    v_group.min_age,
    v_group.max_age,
    'group_vote',
    'locked',
    v_venue_id,
    v_scheduled_starts_at,
    v_scheduled_ends_at,
    v_now,
    v_now,
    v_now,
    v_now
  )
  on conflict (originating_signal_group_id) do nothing
  returning id into v_plan_id;

  if v_plan_id is null then
    select p.id into v_existing_plan_id
    from public.plans p
    where p.originating_signal_group_id = v_group.id;

    if v_existing_plan_id is null then
      raise exception 'signal_plan_conversion_conflict_without_plan' using errcode = 'P0001';
    end if;

    return query select v_existing_plan_id, false;
    return;
  end if;

  -- Conversion inserts several users at once. Acquire the same per-user
  -- admission locks as the membership invariant in deterministic UUID order
  -- before any row is inserted, preventing cross-group lock-order deadlocks.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','live_plan_membership_user_v1',sgm.user_id::text),0
  ))
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true
  order by sgm.user_id;

  insert into public.plan_memberships (
    plan_id,
    user_id,
    membership_state,
    admission_origin,
    joined_at,
    locked_member,
    created_at,
    updated_at
  )
  select
    v_plan_id,
    sgm.user_id,
    'active',
    'signal_lock',
    v_now,
    true,
    v_now,
    v_now
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group.id
    and sgm.state = 'confirmed'::public.signal_group_membership_state
    and sgm.is_active_core = true
  order by sgm.confirmed_at nulls last, sgm.created_at, sgm.id;

  if (
    select count(*)
    from public.plan_memberships pm
    where pm.plan_id = v_plan_id
      and pm.membership_state = 'active'
      and pm.admission_origin = 'signal_lock'
  ) <> v_member_count then
    raise exception 'signal_plan_membership_copy_mismatch' using errcode = 'P0001';
  end if;

  insert into public.conversations (plan_id, created_at)
  values (v_plan_id, v_now)
  returning id into v_conversation_id;

  insert into public.conversation_membership_intervals (
    conversation_id,
    user_id,
    started_at,
    created_at
  )
  select
    v_conversation_id,
    pm.user_id,
    v_now,
    v_now
  from public.plan_memberships pm
  where pm.plan_id = v_plan_id
    and pm.membership_state = 'active'
  order by pm.joined_at, pm.id;

  if (
    select count(*)
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id = v_conversation_id
      and cmi.ended_at is null
  ) <> v_member_count then
    raise exception 'signal_plan_conversation_membership_copy_mismatch' using errcode = 'P0001';
  end if;

  insert into public.plan_history (
    plan_id,
    event_type,
    actor_user_id,
    new_venue_id,
    new_starts_at,
    reason,
    metadata,
    occurred_at
  ) values (
    v_plan_id,
    'created',
    null,
    v_venue_id,
    v_scheduled_starts_at,
    'Converted atomically from authoritative SIGNAL venue and time',
    jsonb_build_object(
      'origin', 'signal',
      'signal_group_id', v_group.id,
      'venue_round_id', v_venue_round_id,
      'venue_option_id', v_venue_option_id,
      'google_place_id', v_venue_place_id,
      'time_round_id', v_time_round_id,
      'time_option_id', v_time_option_id,
      'member_count', v_member_count,
      'activation_threshold', v_policy.activation_threshold,
      'target_capacity', v_policy.target_capacity,
      'max_capacity', v_policy.max_capacity
    ),
    v_now
  ), (
    v_plan_id,
    'locked',
    null,
    v_venue_id,
    v_scheduled_starts_at,
    'SIGNAL venue and time locked',
    jsonb_build_object(
      'signal_group_id', v_group.id,
      'venue_round_id', v_venue_round_id,
      'time_round_id', v_time_round_id
    ),
    v_now
  );

  -- The Signal has successfully handed off to its durable Plan.
  update public.signal_intents si
  set state = 'expired'::public.signal_intent_state,
      updated_at = v_now
  where si.id in (
    select sgm.originating_signal_intent_id
    from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
      and sgm.originating_signal_intent_id is not null
  )
    and si.state = 'assigned'::public.signal_intent_state;

  update public.signal_groups
  set state = 'active_outing'::public.signal_group_state,
      updated_at = v_now
  where id = v_group.id
    and state = 'locked'::public.signal_group_state;

  if not found then
    raise exception 'signal_group_conversion_state_race' using errcode = 'P0001';
  end if;

  return query select v_plan_id, true;
end;
$function$;

alter function public.convert_locked_signal_group_to_plan(uuid) owner to postgres;
revoke all on function public.convert_locked_signal_group_to_plan(uuid) from public, anon;
grant execute on function public.convert_locked_signal_group_to_plan(uuid) to authenticated;

commit;
