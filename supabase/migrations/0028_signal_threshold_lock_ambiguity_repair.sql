begin;

-- ============================================================
-- SIGNAL
-- Migration 0028
-- Threshold-lock ambiguity repair
-- ============================================================
-- Forward-only repair for the immediate threshold lock path.
-- Qualifies signal_group_memberships columns inside the cohort
-- promotion UPDATE so PL/pgSQL output-column variables cannot
-- conflict with table columns at runtime.
-- Lifecycle semantics remain unchanged.
-- ============================================================

create or replace function public.form_or_join_signal(
  p_user_id uuid,
  p_city_id uuid,
  p_activity_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_crowd_mode public.crowd_mode,
  p_min_age integer,
  p_max_age integer,
  p_grouping_policy_code text,
  p_journey_origin public.journey_origin,
  p_vibe_id uuid default null,
  p_preferred_radius_miles numeric default null
)
returns table (
  signal_intent_id uuid,
  signal_group_id uuid,
  group_state public.signal_group_state,
  member_count integer,
  activation_threshold integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();

  v_profile public.user_profiles%rowtype;
  v_user_age integer;

  v_policy public.grouping_policies%rowtype;

  v_intent_id uuid;
  v_group_id uuid;
  v_group_state public.signal_group_state;

  v_member_count integer;
begin
  -- ----------------------------------------------------------
  -- Required input contract.
  -- ----------------------------------------------------------

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_city_id is null then
    raise exception 'city_id is required';
  end if;

  -- ----------------------------------------------------------
  -- Requested Signal city must be operational.
  --
  -- Authorization to use a city is checked separately below.
  -- An authorized user still cannot form a Signal in a city
  -- that has been disabled by the platform.
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.cities c
    where c.id = p_city_id
      and c.is_active = true
  ) then
    raise exception 'signal_city_not_active: %', p_city_id;
  end if;

  if p_activity_id is null then
    raise exception 'activity_id is required';
  end if;

  -- ----------------------------------------------------------
  -- Requested activity / vibe must be operational.
  --
  -- Foreign keys prove identity exists. Signal formation also
  -- requires that the platform currently allows that identity.
  --
  -- Vibe is optional; when omitted there is nothing to validate.
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.activities a
    where a.id = p_activity_id
      and a.is_active = true
  ) then
    raise exception 'signal_activity_not_active: %', p_activity_id;
  end if;

  if p_vibe_id is not null
     and not exists (
       select 1
       from public.vibes v
       where v.id = p_vibe_id
         and v.is_active = true
     ) then
    raise exception 'signal_vibe_not_active: %', p_vibe_id;
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'signal time window is required';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'signal time window is invalid';
  end if;

  if p_ends_at <= v_now then
    raise exception 'signal time window has already ended';
  end if;

  if nullif(btrim(p_grouping_policy_code), '') is null then
    raise exception 'grouping_policy_code is required';
  end if;

  if p_preferred_radius_miles is not null
     and p_preferred_radius_miles <= 0 then
    raise exception 'preferred radius miles must be greater than zero';
  end if;

  if p_min_age is not null and p_min_age < 18 then
    raise exception 'minimum age cannot be below 18';
  end if;

  if p_max_age is not null and p_max_age < 18 then
    raise exception 'maximum age cannot be below 18';
  end if;

  if p_min_age is not null
     and p_max_age is not null
     and p_min_age > p_max_age then
    raise exception 'minimum age cannot exceed maximum age';
  end if;


  -- ----------------------------------------------------------
  -- Authoritative user profile.
  --
  -- A user cannot enter Signal matching without a completed
  -- profile, gender, birth date, and home city.
  -- ----------------------------------------------------------

  select up.*
  into v_profile
  from public.user_profiles up
  where up.user_id = p_user_id
  for update;

  if not found then
    raise exception 'user_profile_not_found: %', p_user_id;
  end if;

  if v_profile.completion_state <> 'complete' then
    raise exception 'user_profile_incomplete: %', p_user_id;
  end if;

  if v_profile.gender is null then
    raise exception 'user_gender_required: %', p_user_id;
  end if;

  if v_profile.birth_date is null then
    raise exception 'user_birth_date_required: %', p_user_id;
  end if;

  if v_profile.home_city_id is null then
    raise exception 'user_home_city_required: %', p_user_id;
  end if;

  -- ----------------------------------------------------------
  -- Authoritative city access.
  --
  -- Home city is always authorized.
  -- Any other city requires a currently valid city access grant.
  -- Signal formation consumes that authorization and remains
  -- independent of the account tier that produced the grant.
  -- ----------------------------------------------------------

  if p_city_id <> v_profile.home_city_id
     and not exists (
       select 1
       from public.city_access_grants cag
       where cag.user_id = p_user_id
         and cag.city_id = p_city_id
         and cag.valid_from <= v_now
         and (
           cag.valid_until is null
           or cag.valid_until > v_now
         )
     ) then
    raise exception
      'signal_city_access_denied: user_id=% city_id=%',
      p_user_id,
      p_city_id;
  end if;

  v_user_age :=
    extract(year from age(current_date, v_profile.birth_date))::integer;


  -- ----------------------------------------------------------
  -- User eligibility for requested Signal.
  -- ----------------------------------------------------------

  if p_min_age is not null and v_user_age < p_min_age then
    raise exception
      'user_below_signal_age_minimum: user_age=% minimum=%',
      v_user_age,
      p_min_age;
  end if;

  if p_max_age is not null and v_user_age > p_max_age then
    raise exception
      'user_above_signal_age_maximum: user_age=% maximum=%',
      v_user_age,
      p_max_age;
  end if;

  if p_crowd_mode = 'women_only'
     and v_profile.gender <> 'female' then
    raise exception 'user_not_eligible_for_women_only_signal';
  end if;

  if p_crowd_mode = 'men_only'
     and v_profile.gender <> 'male' then
    raise exception 'user_not_eligible_for_men_only_signal';
  end if;


  -- ----------------------------------------------------------
  -- Resolve active grouping policy.
  --
  -- No policy UUID is hardcoded.
  -- Highest active version for the requested policy code wins.
  -- ----------------------------------------------------------

  select gp.*
  into v_policy
  from public.grouping_policies gp
  where gp.code = p_grouping_policy_code
    and gp.is_active = true
  order by gp.version desc
  limit 1;

  if not found then
    raise exception
      'active_grouping_policy_not_found: %',
      p_grouping_policy_code;
  end if;


  -- ----------------------------------------------------------
  -- Recover an existing live assignment first.
  --
  -- Reconnect/retry must return the authoritative assigned
  -- intent and group rather than creating a second intent.
  -- Hard identity must match exactly.
  -- ----------------------------------------------------------

  select
    si.id,
    sgm.signal_group_id,
    sg.state
  into
    v_intent_id,
    v_group_id,
    v_group_state
  from public.signal_intents si
  join public.signal_group_memberships sgm
    on sgm.originating_signal_intent_id = si.id
   and sgm.user_id = si.user_id
  join public.signal_groups sg
    on sg.id = sgm.signal_group_id
  where si.user_id = p_user_id
    and si.city_id = p_city_id
    and si.activity_id = p_activity_id
    and si.vibe_id is not distinct from p_vibe_id
    and si.crowd_mode = p_crowd_mode
    and si.min_age is not distinct from p_min_age
    and si.max_age is not distinct from p_max_age
    and si.starts_at = p_starts_at
    and si.ends_at = p_ends_at
    and si.state = 'assigned'
    and sgm.state in ('matched', 'confirmed')
    and sg.city_id = p_city_id
    and sg.activity_id = p_activity_id
    and sg.vibe_id is not distinct from p_vibe_id
    and sg.grouping_policy_id = v_policy.id
    and sg.crowd_mode = p_crowd_mode
    and sg.min_age is not distinct from p_min_age
    and sg.max_age is not distinct from p_max_age
    and sg.starts_at = p_starts_at
    and sg.ends_at = p_ends_at
    and sg.state in ('forming', 'confirming', 'coordinating', 'locked')
    and sg.expires_at > v_now
  order by sg.created_at desc, sg.id desc
  limit 1;

  if v_intent_id is not null then
    select count(*)::integer
    into v_member_count
    from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group_id
      and sgm.state in ('matched', 'confirmed');

    return query
    select
      v_intent_id,
      v_group_id,
      v_group_state,
      v_member_count,
      v_policy.activation_threshold;

    return;
  end if;

  -- ----------------------------------------------------------
  -- No live assignment exists.
  -- Reuse only an exact active hard-identity intent.
  -- ----------------------------------------------------------

  select si.id
  into v_intent_id
  from public.signal_intents si
  where si.user_id = p_user_id
    and si.city_id = p_city_id
    and si.activity_id = p_activity_id
    and si.vibe_id is not distinct from p_vibe_id
    and si.crowd_mode = p_crowd_mode
    and si.min_age is not distinct from p_min_age
    and si.max_age is not distinct from p_max_age
    and si.starts_at = p_starts_at
    and si.ends_at = p_ends_at
    and si.state = 'active'
  order by si.created_at desc, si.id desc
  limit 1
  for update;

  if v_intent_id is null then
    insert into public.signal_intents (
      user_id,
      city_id,
      activity_id,
      vibe_id,
      crowd_mode,
      min_age,
      max_age,
      preferred_radius_miles,
      starts_at,
      ends_at,
      expires_at,
      state,
      journey_origin
    )
    values (
      p_user_id,
      p_city_id,
      p_activity_id,
      p_vibe_id,
      p_crowd_mode,
      p_min_age,
      p_max_age,
      p_preferred_radius_miles,
      p_starts_at,
      p_ends_at,
      p_ends_at,
      'active',
      p_journey_origin
    )
    returning id
    into v_intent_id;
  else
    update public.signal_intents
    set
      preferred_radius_miles = p_preferred_radius_miles,
      expires_at = p_ends_at,
      updated_at = v_now
    where id = v_intent_id;
  end if;


  -- ----------------------------------------------------------
  -- Serialize formation for this exact hard Signal identity.
  --
  -- Row locking alone cannot protect the empty-set case where
  -- simultaneous first callers both observe no compatible group.
  -- This transaction-scoped advisory lock makes one canonical
  -- hard identity enter group lookup/create at a time.
  -- ----------------------------------------------------------

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'signal_formation_v1',
        p_city_id::text,
        p_activity_id::text,
        coalesce(p_vibe_id::text, '<null>'),
        v_policy.id::text,
        p_crowd_mode::text,
        coalesce(p_min_age::text, '<null>'),
        coalesce(p_max_age::text, '<null>'),
        extract(epoch from p_starts_at)::text,
        extract(epoch from p_ends_at)::text
      ),
      0
    )
  );

  -- ----------------------------------------------------------
  -- Find a compatible group that is still accepting
  -- automatic formation members.
  --
  -- FORMING accepts members before activation threshold.
  -- CONFIRMING continues accepting compatible members up to
  -- the policy max_capacity while STILL DOWN confirmation runs.
  --
  -- Hard compatibility:
  --   city
  --   activity
  --   vibe
  --   crowd mode
  --   age bounds
  --   active grouping policy
  --   overlapping Signal time window through expiry
  --
  -- The compatible group is locked before capacity is checked
  -- and membership is added. Combined with the hard-identity
  -- advisory lock above, this serializes automatic admission
  -- and prevents callers from exceeding max_capacity.
  -- ----------------------------------------------------------

  select sg.id
  into v_group_id
  from public.signal_groups sg
  where sg.city_id = p_city_id
    and sg.activity_id = p_activity_id
    and sg.vibe_id is not distinct from p_vibe_id
    and sg.grouping_policy_id = v_policy.id
    and sg.crowd_mode = p_crowd_mode
    and sg.min_age is not distinct from p_min_age
    and sg.max_age is not distinct from p_max_age
    and sg.state = 'forming'::public.signal_group_state
    and sg.starts_at = p_starts_at
    and sg.ends_at = p_ends_at
    and sg.expires_at > v_now
    and (
      select count(*)
      from public.signal_group_memberships capacity_membership
      where capacity_membership.signal_group_id = sg.id
        and capacity_membership.state in ('matched', 'confirmed')
    ) < v_policy.max_capacity
  order by sg.formed_at, sg.id
  limit 1
  for update;


  -- ----------------------------------------------------------
  -- No compatible group exists: create one.
  -- ----------------------------------------------------------

  if v_group_id is null then
    insert into public.signal_groups (
      city_id,
      activity_id,
      vibe_id,
      grouping_policy_id,
      crowd_mode,
      min_age,
      max_age,
      starts_at,
      ends_at,
      state,
      formed_at,
      expires_at
    )
    values (
      p_city_id,
      p_activity_id,
      p_vibe_id,
      v_policy.id,
      p_crowd_mode,
      p_min_age,
      p_max_age,
      p_starts_at,
      p_ends_at,
      'forming',
      v_now,
      p_ends_at
    )
    returning id
    into v_group_id;
  end if;


  -- ----------------------------------------------------------
  -- Enforce automatic formation capacity before membership.
  --
  -- The hard-identity advisory lock above serializes callers
  -- before this count. A group at max_capacity is no longer
  -- eligible for automatic admission; create a fresh compatible
  -- forming group for this caller instead.
  -- ----------------------------------------------------------

  select count(*)::integer
  into v_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group_id
    and sgm.state in ('matched', 'confirmed');

  if v_member_count >= v_policy.max_capacity then
    insert into public.signal_groups (
      city_id,
      activity_id,
      vibe_id,
      grouping_policy_id,
      crowd_mode,
      min_age,
      max_age,
      starts_at,
      ends_at,
      state,
      formed_at,
      expires_at
    )
    values (
      p_city_id,
      p_activity_id,
      p_vibe_id,
      v_policy.id,
      p_crowd_mode,
      p_min_age,
      p_max_age,
      p_starts_at,
      p_ends_at,
      'forming',
      v_now,
      p_ends_at
    )
    returning id
    into v_group_id;

    v_member_count := 0;
  end if;


  -- ----------------------------------------------------------
  -- Add the user once.
  -- ----------------------------------------------------------

  execute $membership_insert$
    insert into public.signal_group_memberships (
      signal_group_id,
      user_id,
      originating_signal_intent_id,
      state,
      is_active_core,
      matched_at
    )
    values ($1, $2, $3, 'matched', false, $4)
    on conflict (signal_group_id, user_id)
    do nothing
  $membership_insert$
  using
    v_group_id,
    p_user_id,
    v_intent_id,
    v_now;


  -- ----------------------------------------------------------
  -- Count current matched/confirmed members.
  -- ----------------------------------------------------------

  select count(*)::integer
  into v_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group_id
    and sgm.state in ('matched', 'confirmed');


  -- ----------------------------------------------------------
  -- Threshold reached.
  --
  -- Atomically promote the complete live cohort and move the
  -- Signal directly from FORMING to LOCKED.
  -- No second STILL DOWN / confirmation phase exists in V1.
  -- ----------------------------------------------------------

  if
    v_member_count >= v_policy.activation_threshold
  then
    update public.signal_group_memberships as sgm
    set
      state =
        'confirmed'::public.signal_group_membership_state,
      is_active_core = true,
      confirmation_deadline = null,
      confirmed_at = coalesce(sgm.confirmed_at, v_now),
      ended_at = null,
      replacement_reason = null,
      updated_at = v_now
    where sgm.signal_group_id = v_group_id
      and sgm.state in (
        'matched'::public.signal_group_membership_state,
        'confirmed'::public.signal_group_membership_state
      );

    update public.signal_groups
    set
      state = 'locked'::public.signal_group_state,
      confirmation_deadline = null,
      coordination_deadline = null,
      locked_at = v_now,
      updated_at = v_now
    where id = v_group_id
      and state = 'forming'::public.signal_group_state;

    v_group_state :=
      'locked'::public.signal_group_state;
  end if;


  -- ----------------------------------------------------------
  -- The intent now has an authoritative Signal assignment.
  -- ----------------------------------------------------------

  update public.signal_intents
  set
    state = 'assigned',
    updated_at = v_now
  where id = v_intent_id;


  select sg.state
  into v_group_state
  from public.signal_groups sg
  where sg.id = v_group_id;


  return query
  select
    v_intent_id,
    v_group_id,
    v_group_state,
    v_member_count,
    v_policy.activation_threshold;
end;
$$;


commit;
