begin;

-- ============================================================
-- SIGNAL / JoinV2
-- 0019_plan_messaging_authority.sql
-- ============================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),

  plan_id uuid not null
    references public.plans(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  constraint conversations_plan_id_key
    unique (plan_id)
);

create table public.conversation_membership_intervals (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.conversations(id)
    on delete cascade,

  user_id uuid not null
    references public.user_profiles(user_id)
    on delete cascade,

  started_at timestamptz not null,
  ended_at timestamptz,

  created_at timestamptz not null default now(),

  constraint conversation_membership_intervals_valid_range
    check (
      ended_at is null
      or ended_at >= started_at
    )
);

create unique index
  conversation_membership_intervals_one_open_per_user
on public.conversation_membership_intervals (
  conversation_id,
  user_id
)
where ended_at is null;

create index
  conversation_membership_intervals_user_lookup_idx
on public.conversation_membership_intervals (
  user_id,
  conversation_id,
  started_at,
  ended_at
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.conversations(id)
    on delete cascade,

  sender_user_id uuid not null
    references public.user_profiles(user_id)
    on delete restrict,

  body text not null,

  sent_at timestamptz not null,

  constraint messages_body_not_blank
    check (length(btrim(body)) > 0),

  constraint messages_body_length
    check (char_length(body) <= 4000)
);

create index
  messages_conversation_timeline_idx
on public.messages (
  conversation_id,
  sent_at,
  id
);

alter table public.conversations
  enable row level security;

alter table public.conversation_membership_intervals
  enable row level security;

alter table public.messages
  enable row level security;

create policy conversations_select_authorized_history
on public.conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id = conversations.id
      and cmi.user_id = auth.uid()
  )
);

create policy conversation_membership_intervals_select_own
on public.conversation_membership_intervals
for select
to authenticated
using (
  user_id = auth.uid()
);

create policy messages_select_authorized_interval
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id = messages.conversation_id
      and cmi.user_id = auth.uid()
      and cmi.started_at <= messages.sent_at
      and (
        cmi.ended_at is null
        or messages.sent_at < cmi.ended_at
      )
  )
);

create or replace function public.send_plan_message(
  p_conversation_id uuid,
  p_body text
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_user_id uuid,
  body text,
  sent_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_body text;
  v_plan_id uuid;
  v_plan_state public.plan_state;
  v_interval_id uuid;
  v_message public.messages%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  if p_conversation_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_id_required';
  end if;

  v_body := btrim(coalesce(p_body, ''));

  if length(v_body) = 0 then
    raise exception using
      errcode = '22023',
      message = 'message_body_required';
  end if;

  if char_length(v_body) > 4000 then
    raise exception using
      errcode = '22023',
      message = 'message_body_too_long';
  end if;

  -- Lock the authoritative Plan before membership authorization.
  -- This serializes message sending against future Plan lifecycle
  -- mutations that use the same Plan-row authority lock.
  select
    p.id,
    p.state
  into
    v_plan_id,
    v_plan_state
  from public.conversations c
  join public.plans p
    on p.id = c.plan_id
  where c.id = p_conversation_id
  for update of p;

  if v_plan_id is null then
    raise exception using
      errcode = '22023',
      message = 'plan_conversation_not_found';
  end if;

  if v_plan_state not in (
    'locked',
    'recovery_required',
    'active_outing'
  ) then
    raise exception using
      errcode = '55000',
      message = 'plan_messaging_read_only';
  end if;

  select cmi.id
  into v_interval_id
  from public.conversation_membership_intervals cmi
  where cmi.conversation_id = p_conversation_id
    and cmi.user_id = v_user_id
    and cmi.started_at <= v_now
    and cmi.ended_at is null
  order by cmi.started_at desc, cmi.id desc
  limit 1
  for update;

  if v_interval_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_membership_required';
  end if;

  insert into public.messages (
    conversation_id,
    sender_user_id,
    body,
    sent_at
  )
  values (
    p_conversation_id,
    v_user_id,
    v_body,
    v_now
  )
  returning *
  into v_message;

  return query
  select
    v_message.id,
    v_message.conversation_id,
    v_message.sender_user_id,
    v_message.body,
    v_message.sent_at;
end;
$$;

alter function public.send_plan_message(uuid, text)
  owner to postgres;

revoke all
on function public.send_plan_message(uuid, text)
from public;

revoke all
on function public.send_plan_message(uuid, text)
from anon;

grant execute
on function public.send_plan_message(uuid, text)
to authenticated;

revoke all
on public.conversations
from anon, authenticated;

revoke all
on public.conversation_membership_intervals
from anon, authenticated;

revoke all
on public.messages
from anon, authenticated;

grant select
on public.conversations
to authenticated;

grant select
on public.conversation_membership_intervals
to authenticated;

grant select
on public.messages
to authenticated;

-- ============================================================
-- Migration-time backfill for Signal-origin Plans that were
-- converted before Plan messaging authority existed.
--
-- Conversation time authority:
--   conversations.created_at = plans.locked_at
--
-- Membership-history time authority:
--   conversation_membership_intervals.started_at =
--     plan_memberships.joined_at
--
-- The table locks prevent an old conversion transaction from
-- creating a Signal Plan between this backfill and replacement
-- of convert_locked_signal_group_to_plan().
-- ============================================================

lock table public.plans
  in share row exclusive mode;

lock table public.plan_memberships
  in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.plans p
    where p.origin = 'signal'
      and p.locked_at is null
  ) then
    raise exception
      'signal_plan_messaging_backfill_missing_locked_at';
  end if;

  if exists (
    select 1
    from public.plans p
    join public.plan_memberships pm
      on pm.plan_id = p.id
    where p.origin = 'signal'
      and pm.membership_state = 'active'
      and pm.admission_origin = 'signal_lock'
      and pm.joined_at is null
  ) then
    raise exception
      'signal_plan_messaging_backfill_missing_joined_at';
  end if;
end
$$;

insert into public.conversations (
  plan_id,
  created_at
)
select
  p.id,
  p.locked_at
from public.plans p
where p.origin = 'signal'
on conflict (plan_id) do nothing;

insert into public.conversation_membership_intervals (
  conversation_id,
  user_id,
  started_at
)
select
  c.id,
  pm.user_id,
  pm.joined_at
from public.plans p
join public.conversations c
  on c.plan_id = p.id
join public.plan_memberships pm
  on pm.plan_id = p.id
where p.origin = 'signal'
  and pm.membership_state = 'active'
  and pm.admission_origin = 'signal_lock'
  and not exists (
    select 1
    from public.conversation_membership_intervals existing
    where existing.conversation_id = c.id
      and existing.user_id = pm.user_id
      and existing.ended_at is null
  )
order by
  p.locked_at,
  p.id,
  pm.joined_at,
  pm.id;

do $$
begin
  if exists (
    select 1
    from public.plans p
    where p.origin = 'signal'
      and not exists (
        select 1
        from public.conversations c
        where c.plan_id = p.id
      )
  ) then
    raise exception
      'signal_plan_messaging_backfill_conversation_mismatch';
  end if;

  if exists (
    select 1
    from public.plans p
    join public.plan_memberships pm
      on pm.plan_id = p.id
    join public.conversations c
      on c.plan_id = p.id
    where p.origin = 'signal'
      and pm.membership_state = 'active'
      and pm.admission_origin = 'signal_lock'
      and not exists (
        select 1
        from public.conversation_membership_intervals cmi
        where cmi.conversation_id = c.id
          and cmi.user_id = pm.user_id
          and cmi.started_at = pm.joined_at
          and cmi.ended_at is null
      )
  ) then
    raise exception
      'signal_plan_messaging_backfill_interval_mismatch';
  end if;
end
$$;

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
as $$
declare
  v_user_id uuid := auth.uid();
  v_group public.signal_groups%rowtype;
  v_policy public.grouping_policies%rowtype;

  v_existing_plan_id uuid;
  v_plan_id uuid;
  v_conversation_id uuid;

  v_member_count integer;

  v_venue_decision_id uuid;
  v_venue_option_id uuid;
  v_venue_id uuid;

  v_time_decision_id uuid;
  v_time_option_id uuid;
  v_scheduled_starts_at timestamptz;

  v_conversion_at timestamptz := clock_timestamp();
begin
  -- ----------------------------------------------------------
  -- Authenticated caller authority.
  --
  -- Conversion is privileged because it creates the Plan,
  -- authoritative Plan memberships, conversation authority,
  -- and immutable Plan history.
  --
  -- The browser supplies only the Signal group identifier.
  -- Caller identity comes exclusively from auth.uid().
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

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
  -- Conversion caller must belong to the exact authoritative
  -- locked cohort that can become Plan membership.
  --
  -- Generic matched Signal visibility is intentionally not
  -- sufficient for this privileged transition.
  -- ----------------------------------------------------------

  perform 1
  from public.signal_group_memberships sgm
  where sgm.signal_group_id = p_signal_group_id
    and sgm.user_id = v_user_id
    and sgm.state = 'confirmed'
    and sgm.is_active_core = true
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'signal_conversion_membership_required';
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
  -- Create the one authoritative Plan conversation only after
  -- Plan membership copy has been verified.
  -- ----------------------------------------------------------

  insert into public.conversations (
    plan_id,
    created_at
  )
  values (
    v_plan_id,
    v_conversion_at
  )
  returning id
  into v_conversation_id;

  if v_conversation_id is null then
    raise exception
      'signal_plan_conversation_creation_failed';
  end if;

  -- ----------------------------------------------------------
  -- Initial chat authority mirrors the authoritative Plan
  -- memberships created by this conversion.
  -- ----------------------------------------------------------

  insert into public.conversation_membership_intervals (
    conversation_id,
    user_id,
    started_at
  )
  select
    v_conversation_id,
    pm.user_id,
    v_conversion_at
  from public.plan_memberships pm
  where pm.plan_id = v_plan_id
    and pm.membership_state = 'active'
    and pm.admission_origin = 'signal_lock'
  order by pm.joined_at, pm.id;

  if (
    select count(*)
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id = v_conversation_id
      and cmi.ended_at is null
  ) <> v_member_count then
    raise exception
      'signal_plan_conversation_membership_copy_mismatch: group=% expected=%',
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

alter function public.convert_locked_signal_group_to_plan(uuid)
  owner to postgres;

revoke all
on function public.convert_locked_signal_group_to_plan(uuid)
from public;

revoke all
on function public.convert_locked_signal_group_to_plan(uuid)
from anon;

grant execute
on function public.convert_locked_signal_group_to_plan(uuid)
to authenticated;


alter table public.messages
  replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception
      'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where
      pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime
      add table public.messages;
  end if;
end
$$;

commit;
