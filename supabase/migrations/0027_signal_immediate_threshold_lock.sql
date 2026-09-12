begin;

-- ============================================================
-- SIGNAL
-- Migration 0027
-- Immediate threshold lock + canonical locked withdrawal
-- ============================================================
--
-- V1 lifecycle:
--
--   I'M DOWN
--     -> FORMING
--     -> threshold reached
--     -> atomic cohort promotion
--     -> LOCKED
--
-- There is no second STILL DOWN confirmation requirement.
--
-- Locked Signals are not automatic formation admission targets.
--
-- Locked members may leave before Signal -> Plan conversion.
-- Losing critical mass reopens the group to FORMING.
--
-- Withdrawal and conversion serialize on the Signal GROUP row.
-- ============================================================


-- ============================================================
-- 1. FORMATION AUTHORITY
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
    update public.signal_group_memberships
    set
      state =
        'confirmed'::public.signal_group_membership_state,
      is_active_core = true,
      confirmation_deadline = null,
      confirmed_at = coalesce(confirmed_at, v_now),
      ended_at = null,
      replacement_reason = null,
      updated_at = v_now
    where signal_group_id = v_group_id
      and state in (
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


-- ============================================================
-- 2. NAMED-WINDOW RESOLVER AUTHORITY
-- ============================================================

create or replace function public.resolve_and_form_signal(
  p_user_id uuid,
  p_city_slug text,
  p_activity_slug text,
  p_time_window text,
  p_crowd_mode public.crowd_mode,
  p_min_age integer,
  p_max_age integer,
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

  v_city public.cities%rowtype;
  v_activity public.activities%rowtype;
  v_policy public.grouping_policies%rowtype;

  v_local_now timestamp;
  v_local_date date;
  v_local_time time;

  v_requested_starts_at timestamptz;
  v_requested_ends_at timestamptz;

  v_delegate_starts_at timestamptz;
  v_delegate_ends_at timestamptz;

  v_effective_min_age integer;

  v_time_window_code text;
  v_time_window_key text;

  v_occurrence_date date;
  v_days_until_friday integer;
  v_friday date;

  v_existing_group_id uuid;
  v_existing_group_starts_at timestamptz;
  v_existing_group_ends_at timestamptz;

  v_result_intent_id uuid;
  v_result_group_id uuid;
  v_result_group_state public.signal_group_state;
  v_result_member_count integer;
  v_result_activation_threshold integer;
begin

  -- ==========================================================
  -- REQUIRED INTENT
  -- ==========================================================

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if nullif(btrim(p_city_slug), '') is null then
    raise exception 'city_slug is required';
  end if;

  if nullif(btrim(p_activity_slug), '') is null then
    raise exception 'activity_slug is required';
  end if;

  if nullif(btrim(p_time_window), '') is null then
    raise exception 'time_window is required';
  end if;

  v_time_window_code := upper(btrim(p_time_window));

  if v_time_window_code not in (
    'NOW',
    'TONIGHT',
    'TOMORROW',
    'THIS_WEEKEND'
  ) then
    raise exception
      'unsupported_signal_time_window: %',
      p_time_window;
  end if;


  -- ==========================================================
  -- AUTHORITATIVE CITY
  -- ==========================================================

  select c.*
  into v_city
  from public.cities c
  where c.slug = lower(btrim(p_city_slug))
    and c.is_active = true;

  if not found then
    raise exception
      'signal_city_not_active_or_not_found: %',
      p_city_slug;
  end if;

  if nullif(btrim(v_city.timezone_name), '') is null then
    raise exception
      'signal_city_timezone_not_configured: %',
      v_city.slug;
  end if;

  if not public.is_valid_timezone_name(v_city.timezone_name) then
    raise exception
      'signal_city_timezone_invalid: city=% timezone=%',
      v_city.slug,
      v_city.timezone_name;
  end if;


  -- ==========================================================
  -- AUTHORITATIVE ACTIVITY
  -- ==========================================================

  select a.*
  into v_activity
  from public.activities a
  where a.slug = lower(btrim(p_activity_slug))
    and a.is_active = true;

  if not found then
    raise exception
      'signal_activity_not_active_or_not_found: %',
      p_activity_slug;
  end if;

  if nullif(
       btrim(v_activity.grouping_policy_code),
       ''
     ) is null then
    raise exception
      'signal_activity_grouping_policy_not_configured: %',
      v_activity.slug;
  end if;


  -- ==========================================================
  -- AUTHORITATIVE ACTIVE POLICY VERSION
  --
  -- This lookup exists so the resolver-side named-window lock
  -- and preselection use the exact policy version that 0003
  -- will independently resolve and enforce again.
  -- ==========================================================

  select gp.*
  into v_policy
  from public.grouping_policies gp
  where gp.code = v_activity.grouping_policy_code
    and gp.is_active = true
  order by gp.version desc
  limit 1;

  if not found then
    raise exception
      'signal_grouping_policy_not_active: %',
      v_activity.grouping_policy_code;
  end if;


  -- ==========================================================
  -- CROWD AGE PREFERENCE VALIDATION
  -- ==========================================================

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

  v_effective_min_age :=
    case
      when v_activity.minimum_age is null then
        p_min_age

      when p_min_age is null then
        v_activity.minimum_age

      else
        greatest(
          p_min_age,
          v_activity.minimum_age
        )
    end;

  if p_max_age is not null
     and v_effective_min_age is not null
     and p_max_age < v_effective_min_age then
    raise exception
      'signal_age_range_conflicts_with_activity_minimum: activity=% minimum=% maximum=%',
      v_activity.slug,
      v_effective_min_age,
      p_max_age;
  end if;


  -- ==========================================================
  -- CITY-LOCAL CLOCK
  -- ==========================================================

  v_local_now :=
    v_now at time zone v_city.timezone_name;

  v_local_date :=
    v_local_now::date;

  v_local_time :=
    v_local_now::time;


  -- ==========================================================
  -- NAMED WINDOW OCCURRENCE + OPERATIONAL WINDOW
  -- ==========================================================

  case v_time_window_code

    -- --------------------------------------------------------
    -- NOW
    --
    -- NOW does not use a clock bucket.
    --
    -- The stable key says "currently active NOW intent."
    -- Group lifecycle determines which actual group is reusable.
    -- --------------------------------------------------------

    when 'NOW' then

      v_time_window_key := 'NOW';

      v_requested_starts_at := v_now;

      v_requested_ends_at :=
        v_now + interval '3 hours';


    -- --------------------------------------------------------
    -- TONIGHT
    --
    -- Occurrence key is the local date on which that evening's
    -- 5 PM window begins.
    -- --------------------------------------------------------

    when 'TONIGHT' then

      if v_local_time < time '02:00:00' then

        v_occurrence_date :=
          v_local_date - 1;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            v_local_date
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      elsif v_local_time >= time '17:00:00' then

        v_occurrence_date :=
          v_local_date;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            (v_local_date + 1)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      else

        v_occurrence_date :=
          v_local_date;

        v_requested_starts_at :=
          (
            v_local_date
            + time '17:00:00'
          ) at time zone v_city.timezone_name;

        v_requested_ends_at :=
          (
            (v_local_date + 1)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      end if;

      v_time_window_key :=
        'TONIGHT:' || v_occurrence_date::text;


    -- --------------------------------------------------------
    -- TOMORROW
    -- --------------------------------------------------------

    when 'TOMORROW' then

      v_occurrence_date :=
        v_local_date + 1;

      v_time_window_key :=
        'TOMORROW:' || v_occurrence_date::text;

      v_requested_starts_at :=
        (
          v_occurrence_date
          + time '06:00:00'
        ) at time zone v_city.timezone_name;

      v_requested_ends_at :=
        (
          (v_occurrence_date + 1)
          + time '02:00:00'
        ) at time zone v_city.timezone_name;


    -- --------------------------------------------------------
    -- THIS WEEKEND
    --
    -- Occurrence key is Friday's local calendar date.
    -- --------------------------------------------------------

    when 'THIS_WEEKEND' then

      if (
        extract(dow from v_local_date)::integer = 5
        and v_local_time >= time '17:00:00'
      ) then

        v_friday :=
          v_local_date;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            (v_local_date + 3)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      elsif extract(dow from v_local_date)::integer = 6 then

        v_friday :=
          v_local_date - 1;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            (v_local_date + 2)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      elsif extract(dow from v_local_date)::integer = 0 then

        v_friday :=
          v_local_date - 2;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            (v_local_date + 1)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      elsif (
        extract(dow from v_local_date)::integer = 1
        and v_local_time < time '02:00:00'
      ) then

        v_friday :=
          v_local_date - 3;

        v_requested_starts_at :=
          v_now;

        v_requested_ends_at :=
          (
            v_local_date
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      else

        v_days_until_friday :=
          (
            5
            - extract(dow from v_local_date)::integer
            + 7
          ) % 7;

        if v_days_until_friday = 0 then
          v_friday :=
            v_local_date;
        else
          v_friday :=
            v_local_date + v_days_until_friday;
        end if;

        v_requested_starts_at :=
          (
            v_friday
            + time '17:00:00'
          ) at time zone v_city.timezone_name;

        v_requested_ends_at :=
          (
            (v_friday + 3)
            + time '02:00:00'
          ) at time zone v_city.timezone_name;

      end if;

      v_time_window_key :=
        'THIS_WEEKEND:' || v_friday::text;

  end case;


  -- ==========================================================
  -- RESOLVED WINDOW SAFETY
  -- ==========================================================

  if v_requested_starts_at is null
     or v_requested_ends_at is null then
    raise exception
      'signal_time_window_resolution_failed';
  end if;

  if v_requested_ends_at <= v_requested_starts_at then
    raise exception
      'signal_time_window_resolution_invalid: starts_at=% ends_at=%',
      v_requested_starts_at,
      v_requested_ends_at;
  end if;

  if v_requested_ends_at <= v_now then
    raise exception
      'signal_time_window_resolution_already_ended';
  end if;

  if nullif(btrim(v_time_window_key), '') is null then
    raise exception
      'signal_time_window_identity_resolution_failed';
  end if;


  -- ==========================================================
  -- NAMED-WINDOW CONCURRENCY LOCK
  --
  -- This is deliberately BEFORE group preselection.
  --
  -- Exact wall-clock timestamps are NOT part of this lock.
  --
  -- Therefore two simultaneous NOW callers with the same hard
  -- compatibility identity cannot both observe an empty named
  -- window and independently create separate first groups.
  --
  -- 0003 still takes its own exact hard-identity lock afterward.
  -- ==========================================================

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        'signal_named_window_v1',
        v_city.id::text,
        v_activity.id::text,
        coalesce(p_vibe_id::text, '<null>'),
        v_policy.id::text,
        p_crowd_mode::text,
        coalesce(v_effective_min_age::text, '<null>'),
        coalesce(p_max_age::text, '<null>'),
        v_time_window_code,
        v_time_window_key
      ),
      0
    )
  );


  -- ==========================================================
  -- USER ASSIGNMENT RECOVERY
  --
  -- A retry by an already-assigned user must return that user's
  -- existing live Signal even if another group for the same NOW
  -- identity is currently forming.
  --
  -- Once found, the group's original exact operational timestamps
  -- are delegated to 0003 so its proven assigned-intent recovery
  -- path remains authoritative.
  -- ==========================================================

  select
    sg.id,
    sg.starts_at,
    sg.ends_at
  into
    v_existing_group_id,
    v_existing_group_starts_at,
    v_existing_group_ends_at
  from public.signal_intents si
  join public.signal_group_memberships sgm
    on sgm.originating_signal_intent_id = si.id
   and sgm.user_id = p_user_id
   and sgm.state in ('matched', 'confirmed')
  join public.signal_groups sg
    on sg.id = sgm.signal_group_id
  where si.user_id = p_user_id
    and si.city_id = v_city.id
    and si.activity_id = v_activity.id
    and si.vibe_id is not distinct from p_vibe_id
    and si.crowd_mode = p_crowd_mode
    and si.min_age is not distinct from v_effective_min_age
    and si.max_age is not distinct from p_max_age
    and si.state = 'assigned'
    and sg.grouping_policy_id = v_policy.id
    and sg.time_window_code = v_time_window_code
    and sg.time_window_key = v_time_window_key
    and sg.state in (
      'forming',
      'confirming',
      'coordinating',
      'locked'
    )
    and sg.expires_at > v_now
  order by sg.created_at desc, sg.id desc
  limit 1;

  if v_existing_group_id is not null then

    v_delegate_starts_at :=
      v_existing_group_starts_at;

    v_delegate_ends_at :=
      v_existing_group_ends_at;

  else

    -- ========================================================
    -- ACCEPTING GROUP PRESELECTION
    --
    -- Automatic formation admission reuses FORMING groups only.
    -- LOCKED groups are not admission targets for new callers.
    --
    -- Capacity is checked here only to choose an eligible group's
    -- exact timestamps.
    --
    -- 0003 independently re-locks/revalidates group capacity.
    -- ========================================================

    select
      sg.id,
      sg.starts_at,
      sg.ends_at
    into
      v_existing_group_id,
      v_existing_group_starts_at,
      v_existing_group_ends_at
    from public.signal_groups sg
    where sg.city_id = v_city.id
      and sg.activity_id = v_activity.id
      and sg.vibe_id is not distinct from p_vibe_id
      and sg.grouping_policy_id = v_policy.id
      and sg.crowd_mode = p_crowd_mode
      and sg.min_age is not distinct from v_effective_min_age
      and sg.max_age is not distinct from p_max_age
      and sg.time_window_code = v_time_window_code
      and sg.time_window_key = v_time_window_key
      and sg.state = 'forming'::public.signal_group_state
      and sg.expires_at > v_now
      and (
        select count(*)
        from public.signal_group_memberships capacity_membership
        where capacity_membership.signal_group_id = sg.id
          and capacity_membership.state in (
            'matched',
            'confirmed'
          )
      ) < v_policy.max_capacity
    order by sg.formed_at, sg.id
    limit 1
    for update;

    if v_existing_group_id is not null then

      v_delegate_starts_at :=
        v_existing_group_starts_at;

      v_delegate_ends_at :=
        v_existing_group_ends_at;

    else

      v_delegate_starts_at :=
        v_requested_starts_at;

      v_delegate_ends_at :=
        v_requested_ends_at;

    end if;

  end if;


  -- ==========================================================
  -- DELEGATE TO PROVEN 0003 FORMATION ENGINE
  -- ==========================================================

  select
    formed.signal_intent_id,
    formed.signal_group_id,
    formed.group_state,
    formed.member_count,
    formed.activation_threshold
  into
    v_result_intent_id,
    v_result_group_id,
    v_result_group_state,
    v_result_member_count,
    v_result_activation_threshold
  from public.form_or_join_signal(
    p_user_id,
    v_city.id,
    v_activity.id,
    v_delegate_starts_at,
    v_delegate_ends_at,
    p_crowd_mode,
    v_effective_min_age,
    p_max_age,
    v_activity.grouping_policy_code,
    p_journey_origin,
    p_vibe_id,
    p_preferred_radius_miles
  ) formed;


  if v_result_intent_id is null
     or v_result_group_id is null then
    raise exception
      'signal_formation_returned_no_assignment';
  end if;


  -- ==========================================================
  -- OCCURRENCE IDENTITY INTEGRITY
  --
  -- Never silently retag a row from a different named occurrence.
  -- ==========================================================

  if exists (
    select 1
    from public.signal_intents si
    where si.id = v_result_intent_id
      and (
        (
          si.time_window_code is not null
          and si.time_window_code <> v_time_window_code
        )
        or (
          si.time_window_key is not null
          and si.time_window_key <> v_time_window_key
        )
      )
  ) then
    raise exception
      'signal_intent_time_window_identity_conflict';
  end if;

  if exists (
    select 1
    from public.signal_groups sg
    where sg.id = v_result_group_id
      and (
        (
          sg.time_window_code is not null
          and sg.time_window_code <> v_time_window_code
        )
        or (
          sg.time_window_key is not null
          and sg.time_window_key <> v_time_window_key
        )
      )
  ) then
    raise exception
      'signal_group_time_window_identity_conflict';
  end if;


  update public.signal_intents
  set
    time_window_code = v_time_window_code,
    time_window_key = v_time_window_key,
    updated_at = v_now
  where id = v_result_intent_id;

  update public.signal_groups
  set
    time_window_code = v_time_window_code,
    time_window_key = v_time_window_key,
    updated_at = v_now
  where id = v_result_group_id;


  return query
  select
    v_result_intent_id,
    v_result_group_id,
    v_result_group_state,
    v_result_member_count,
    v_result_activation_threshold;

end;
$$;


-- ============================================================
-- 3. AUTHENTICATED WITHDRAWAL AUTHORITY
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

  v_plan_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_signal_intent_id is null then
    raise exception 'signal_intent_id_required';
  end if;

  /*
   * Resolve identifiers first without row locks.
   * Browser-supplied identity is never trusted.
   */
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
  where si.id = p_signal_intent_id
    and si.user_id = v_user_id
    and si.state =
      'assigned'::public.signal_intent_state
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    );

  if
    v_intent_id is null
    or v_membership_id is null
    or v_group_id is null
  then
    raise exception 'live_signal_assignment_not_found';
  end if;

  /*
   * Canonical lifecycle serialization begins with GROUP.
   */
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

  /*
   * Revalidate caller-owned assignment after acquiring GROUP.
   * Lock order:
   *
   *   GROUP -> INTENT -> MEMBERSHIP
   */
  select
    si.id,
    sgm.id
  into
    v_intent_id,
    v_membership_id
  from public.signal_intents si
  join public.signal_group_memberships sgm
    on sgm.originating_signal_intent_id = si.id
   and sgm.user_id = si.user_id
   and sgm.signal_group_id = v_group_id
  where si.id = p_signal_intent_id
    and si.user_id = v_user_id
    and si.state =
      'assigned'::public.signal_intent_state
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    )
  for update of si, sgm;

  if
    v_intent_id is null
    or v_membership_id is null
  then
    raise exception 'live_signal_assignment_not_found';
  end if;

  /*
   * Allowed pre-Plan departure states.
   */
  if v_group_state not in (
    'forming'::public.signal_group_state,
    'confirming'::public.signal_group_state,
    'coordinating'::public.signal_group_state,
    'locked'::public.signal_group_state
  ) then
    raise exception
      'signal_group_not_withdrawable: %',
      v_group_state;
  end if;

  /*
   * Once the Signal has converted, Plan membership authority owns
   * departure. Do not mutate the source Signal cohort afterward.
   */
  if v_group_state =
    'locked'::public.signal_group_state
  then
    select p.id
    into v_plan_id
    from public.plans p
    where p.originating_signal_group_id = v_group_id
    limit 1;

    if v_plan_id is not null then
      raise exception
        'signal_already_converted_to_plan';
    end if;
  end if;

  update public.signal_intents
  set
    state = 'withdrawn'::public.signal_intent_state,
    updated_at = v_now
  where id = v_intent_id;

  update public.signal_group_memberships
  set
    state =
      'withdrawn'::public.signal_group_membership_state,
    is_active_core = false,
    confirmation_deadline = null,
    ended_at = v_now,
    replacement_reason = 'user_withdrew',
    updated_at = v_now
  where id = v_membership_id;

  select count(*)::integer
  into v_remaining_member_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = v_group_id
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    );

  /*
   * Losing critical mass reopens the Signal.
   *
   * Surviving confirmed active-core members remain committed.
   * New formation members enter matched/non-core.
   * A later threshold crossing atomically promotes the complete
   * live cohort and establishes a fresh lock timestamp.
   */
  if
    v_remaining_member_count < v_activation_threshold
    and v_group_state in (
      'confirming'::public.signal_group_state,
      'coordinating'::public.signal_group_state,
      'locked'::public.signal_group_state
    )
  then
    update public.signal_groups
    set
      state = 'forming'::public.signal_group_state,
      confirmation_deadline = null,
      coordination_deadline = null,
      locked_at = null,
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


-- Preserve internal formation execution boundary.

revoke all
on function public.form_or_join_signal(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  public.crowd_mode,
  integer,
  integer,
  text,
  public.journey_origin,
  uuid,
  numeric
)
from public;

revoke all
on function public.form_or_join_signal(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  public.crowd_mode,
  integer,
  integer,
  text,
  public.journey_origin,
  uuid,
  numeric
)
from anon;

revoke all
on function public.form_or_join_signal(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  public.crowd_mode,
  integer,
  integer,
  text,
  public.journey_origin,
  uuid,
  numeric
)
from authenticated;

grant execute
on function public.form_or_join_signal(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  public.crowd_mode,
  integer,
  integer,
  text,
  public.journey_origin,
  uuid,
  numeric
)
to service_role;


-- Preserve internal resolver execution boundary.

revoke all
on function public.resolve_and_form_signal(
  uuid,
  text,
  text,
  text,
  public.crowd_mode,
  integer,
  integer,
  public.journey_origin,
  uuid,
  numeric
)
from public;

revoke all
on function public.resolve_and_form_signal(
  uuid,
  text,
  text,
  text,
  public.crowd_mode,
  integer,
  integer,
  public.journey_origin,
  uuid,
  numeric
)
from anon;

revoke all
on function public.resolve_and_form_signal(
  uuid,
  text,
  text,
  text,
  public.crowd_mode,
  integer,
  integer,
  public.journey_origin,
  uuid,
  numeric
)
from authenticated;

grant execute
on function public.resolve_and_form_signal(
  uuid,
  text,
  text,
  text,
  public.crowd_mode,
  integer,
  integer,
  public.journey_origin,
  uuid,
  numeric
)
to service_role;


-- Preserve authenticated withdrawal execution contract.

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
'Withdraws auth.uid() from their own matched/confirmed Signal before Signal-to-Plan conversion. Uses canonical GROUP -> INTENT -> MEMBERSHIP serialization. Locked withdrawal is permitted only while no Signal-origin Plan exists. Loss of critical mass reopens the Signal to forming and clears locked_at; surviving confirmed active-core members remain committed for refill.';


commit;
