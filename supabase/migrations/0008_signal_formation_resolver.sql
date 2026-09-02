begin;

-- ============================================================
-- SIGNAL FORMATION RESOLVER
--
-- Human product intent:
--   city slug
--   activity slug
--   named time window
--   crowd preferences
--
-- PostgreSQL owns:
--   catalog UUID resolution
--   city timezone
--   concrete operational timestamps
--   activity minimum age
--   effective minimum age
--   grouping policy
--   stable named-window occurrence identity
--   named-window concurrency serialization
--
-- IMPORTANT:
--
-- form_or_join_signal() from 0003 remains the authoritative
-- formation engine for:
--   profile completion
--   city authorization
--   crowd eligibility
--   exact intent recovery
--   group capacity
--   membership creation
--   threshold transition
--
-- This migration does NOT rewrite 0003.
--
-- Instead, the resolver gives named product windows a stable
-- identity before delegating to 0003.
--
-- For NOW:
--   A compatible group remains reusable while it is FORMING,
--   or while it is CONFIRMING with an open confirmation deadline.
--
--   If an existing compatible NOW group is accepting members,
--   its exact stored starts_at / ends_at are reused when calling
--   form_or_join_signal().
--
--   Therefore users who click NOW minutes apart can converge on
--   the same live Signal without making wall-clock timestamps
--   the named-window identity.
--
-- TONIGHT / TOMORROW / THIS_WEEKEND use a canonical occurrence
-- key based on the authoritative city-local calendar.
-- ============================================================


-- ============================================================
-- NAMED WINDOW IDENTITY
--
-- Nullable for historical / legacy formation rows created before
-- the resolver authority existed.
--
-- New resolver-created Signal rows receive both values.
-- ============================================================

alter table public.signal_intents
  add column if not exists time_window_code text;

alter table public.signal_intents
  add column if not exists time_window_key text;

alter table public.signal_groups
  add column if not exists time_window_code text;

alter table public.signal_groups
  add column if not exists time_window_key text;


-- ============================================================
-- WINDOW PAIR INTEGRITY
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.signal_intents'::regclass
      and conname = 'signal_intents_time_window_identity_check'
  ) then
    alter table public.signal_intents
      add constraint signal_intents_time_window_identity_check
      check (
        (
          time_window_code is null
          and time_window_key is null
        )
        or (
          time_window_code in (
            'NOW',
            'TONIGHT',
            'TOMORROW',
            'THIS_WEEKEND'
          )
          and nullif(btrim(time_window_key), '') is not null
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.signal_groups'::regclass
      and conname = 'signal_groups_time_window_identity_check'
  ) then
    alter table public.signal_groups
      add constraint signal_groups_time_window_identity_check
      check (
        (
          time_window_code is null
          and time_window_key is null
        )
        or (
          time_window_code in (
            'NOW',
            'TONIGHT',
            'TOMORROW',
            'THIS_WEEKEND'
          )
          and nullif(btrim(time_window_key), '') is not null
        )
      );
  end if;
end;
$$;


-- ============================================================
-- RESOLVER LOOKUP INDEXES
-- ============================================================

create index if not exists signal_groups_named_window_lookup_idx
  on public.signal_groups (
    city_id,
    activity_id,
    time_window_code,
    time_window_key,
    state,
    expires_at
  )
  where time_window_code is not null;

create index if not exists signal_intents_named_window_user_idx
  on public.signal_intents (
    user_id,
    time_window_code,
    time_window_key,
    state
  )
  where time_window_code is not null;


-- ============================================================
-- SIGNAL FORMATION RESOLVER
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
    -- Same lifecycle already proven in 0003:
    --   FORMING
    --   CONFIRMING while confirmation deadline remains open
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
      and (
        sg.state = 'forming'
        or (
          sg.state = 'confirming'
          and sg.confirmation_deadline is not null
          and sg.confirmation_deadline > v_now
        )
      )
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
-- SECURITY BOUNDARY
-- ============================================================

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


comment on function public.resolve_and_form_signal(
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
) is
  'Server-only Signal resolver. Owns catalog resolution, city-local named windows, stable named-window occurrence identity and named-window serialization before delegating to the proven form_or_join_signal() engine.';


comment on column public.signal_intents.time_window_code is
  'Named Signal product window resolved by PostgreSQL: NOW, TONIGHT, TOMORROW, or THIS_WEEKEND. Nullable only for historical/legacy rows.';

comment on column public.signal_intents.time_window_key is
  'Stable named-window occurrence identity. NOW uses lifecycle-based active intent identity; calendar windows use city-local occurrence dates.';

comment on column public.signal_groups.time_window_code is
  'Named Signal product window resolved by PostgreSQL. Used with time_window_key for resolver-side matching identity.';

comment on column public.signal_groups.time_window_key is
  'Stable named-window occurrence identity used before exact operational timestamps are delegated to the formation engine.';


commit;
