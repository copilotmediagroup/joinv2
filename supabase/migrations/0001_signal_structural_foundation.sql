begin;

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================

create type public.profile_completion_state as enum (
  'incomplete',
  'complete'
);

create type public.entitlement_tier as enum (
  'free',
  'pro'
);

create type public.signal_intent_state as enum (
  'active',
  'assigned',
  'withdrawn',
  'expired'
);

create type public.signal_group_state as enum (
  'forming',
  'confirming',
  'coordinating',
  'locked',
  'active_outing',
  'completed',
  'cancelled',
  'expired'
);

create type public.signal_group_membership_state as enum (
  'matched',
  'confirmed',
  'declined',
  'timed_out',
  'withdrawn',
  'replaced'
);

create type public.crowd_mode as enum (
  'everyone',
  'women_only',
  'men_only'
);

create type public.journey_origin as enum (
  'direct_signal',
  'im_bored',
  'manual_plan'
);

create type public.venue_candidate_source as enum (
  'organic',
  'member_suggested',
  'platform_suggested',
  'sponsored'
);

create type public.plan_origin as enum (
  'manual',
  'signal'
);

create type public.admission_mode as enum (
  'open',
  'creator_approval',
  'group_vote'
);

create type public.plan_state as enum (
  'draft',
  'published',
  'locked',
  'recovery_required',
  'active_outing',
  'completed',
  'cancelled'
);

create type public.admission_request_state as enum (
  'pending',
  'approved',
  'rejected',
  'expired',
  'withdrawn'
);

create type public.decision_type as enum (
  'venue_selection',
  'time_selection',
  'plan_admission',
  'venue_recovery',
  'reschedule',
  'cancellation'
);

create type public.decision_state as enum (
  'open',
  'final_call',
  'runoff',
  'finalized',
  'cancelled',
  'expired'
);

create type public.decision_round_type as enum (
  'primary',
  'runoff',
  'final_call'
);

create type public.attendance_evidence_type as enum (
  'self_reported',
  'location_supported',
  'partner_verified',
  'system_verified'
);

create type public.attribution_event_type as enum (
  'impression',
  'view',
  'vote',
  'selected',
  'plan_locked',
  'directions_opened',
  'directed',
  'redirected',
  'attendance_evidence'
);

create type public.economic_value_type as enum (
  'estimated_directed',
  'estimated_attendance',
  'verified_spend'
);

create type public.notification_state as enum (
  'unread',
  'read'
);

create type public.plan_membership_state as enum (
  'active',
  'withdrawn',
  'removed',
  'completed'
);

create type public.admission_origin as enum (
  'creator',
  'signal_lock',
  'open_join',
  'creator_approval',
  'group_vote',
  'post_lock_admission',
  'admin_correction'
);

create type public.business_partner_status as enum (
  'pending',
  'active',
  'suspended',
  'ended'
);

create type public.sponsored_campaign_status as enum (
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'cancelled'
);

create type public.plan_history_event_type as enum (
  'created',
  'published',
  'locked',
  'member_withdrew',
  'member_removed',
  'member_admitted',
  'seat_reopened',
  'venue_recovery_started',
  'venue_changed',
  'reschedule_started',
  'time_changed',
  'recovery_required',
  'recovery_resolved',
  'active_outing',
  'cancelled',
  'completed',
  'admin_corrected'
);

create type public.discovery_interaction_type as enum (
  'selected',
  'passed',
  'skipped',
  'surprise_me'
);

-- ============================================================
-- GEOGRAPHY
-- ============================================================

create table public.states (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint states_code_key unique (code),
  constraint states_name_key unique (name)
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.states(id),
  name text not null,
  slug text not null,
  latitude numeric,
  longitude numeric,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint cities_state_name_key unique (state_id, name),
  constraint cities_slug_key unique (slug)
);

-- ============================================================
-- USER IDENTITY
-- ============================================================

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  bio text,
  birth_date date,
  home_city_id uuid references public.cities(id),
  completion_state public.profile_completion_state not null default 'incomplete',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_profiles_completion_check check (
    completion_state <> 'complete'
    or (
      nullif(btrim(display_name), '') is not null
      and nullif(btrim(avatar_path), '') is not null
      and home_city_id is not null
    )
  )
);

create view public.public_profiles as
select
  p.user_id,
  p.display_name,
  p.avatar_path,
  p.bio,
  p.home_city_id,
  case
    when p.birth_date is null then null
    else extract(year from age(current_date, p.birth_date))::integer
  end as age
from public.user_profiles p
where p.completion_state = 'complete';

-- ============================================================
-- ENTITLEMENTS
-- ============================================================

create table public.account_entitlements (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  tier public.entitlement_tier not null default 'free',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_entitlements_validity_check check (
    valid_until is null or valid_until > valid_from
  )
);

create table public.city_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  city_id uuid not null references public.cities(id),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  source text not null,
  created_at timestamptz not null default now(),

  constraint city_access_grants_validity_check check (
    valid_until is null or valid_until > valid_from
  )
);

-- ============================================================
-- ACTIVITIES + DISCOVERY CONFIG
-- ============================================================

create table public.activity_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint activity_categories_name_key unique (name),
  constraint activity_categories_slug_key unique (slug)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.activity_categories(id),
  name text not null,
  slug text not null,
  default_min_group integer,
  default_target_group integer,
  default_max_group integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint activities_slug_key unique (slug),

  constraint activities_group_sizes_check check (
    (default_min_group is null or default_min_group > 0)
    and (default_target_group is null or default_target_group > 0)
    and (default_max_group is null or default_max_group > 0)
    and (
      default_min_group is null
      or default_target_group is null
      or default_min_group <= default_target_group
    )
    and (
      default_target_group is null
      or default_max_group is null
      or default_target_group <= default_max_group
    )
  )
);

create table public.vibes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint vibes_name_key unique (name),
  constraint vibes_slug_key unique (slug)
);

create table public.discovery_options (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  option_type text not null,
  activity_id uuid references public.activities(id),
  activity_category_id uuid references public.activity_categories(id),
  vibe_id uuid references public.vibes(id),
  metadata jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.grouping_policies (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null,
  activation_threshold integer not null,
  target_capacity integer not null,
  max_capacity integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint grouping_policies_code_version_key unique (code, version),

  constraint grouping_policies_capacity_check check (
    activation_threshold > 0
    and activation_threshold <= target_capacity
    and target_capacity <= max_capacity
  )
);

-- ============================================================
-- I'M BORED
-- ============================================================

create table public.discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),

  constraint discovery_sessions_time_check check (
    ended_at is null or ended_at >= started_at
  )
);

create table public.discovery_interactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.discovery_sessions(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  discovery_option_id uuid references public.discovery_options(id),
  interaction_type public.discovery_interaction_type not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb
);

-- ============================================================
-- SIGNAL INTENT
-- ============================================================

create table public.signal_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  city_id uuid not null references public.cities(id),
  activity_id uuid not null references public.activities(id),
  vibe_id uuid references public.vibes(id),
  crowd_mode public.crowd_mode not null default 'everyone',
  min_age integer,
  max_age integer,
  preferred_radius_miles numeric,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  state public.signal_intent_state not null default 'active',
  journey_origin public.journey_origin not null,
  discovery_session_id uuid references public.discovery_sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signal_intents_time_check check (
    ends_at > starts_at
    and expires_at >= starts_at
  ),

  constraint signal_intents_age_check check (
    (min_age is null or min_age >= 18)
    and (
      min_age is null
      or max_age is null
      or max_age >= min_age
    )
  ),

  constraint signal_intents_radius_check check (
    preferred_radius_miles is null
    or preferred_radius_miles > 0
  )
);

alter table public.discovery_sessions
  add column created_signal_intent_id uuid;

alter table public.discovery_sessions
  add constraint discovery_sessions_created_signal_intent_fk
  foreign key (created_signal_intent_id)
  references public.signal_intents(id);

create table public.signal_intent_availability (
  id uuid primary key default gen_random_uuid(),
  signal_intent_id uuid not null references public.signal_intents(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_hard boolean not null default true,
  created_at timestamptz not null default now(),

  constraint signal_intent_availability_time_check check (
    ends_at > starts_at
  )
);

-- ============================================================
-- SIGNAL GROUPS
-- ============================================================

create table public.signal_groups (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id),
  activity_id uuid not null references public.activities(id),
  vibe_id uuid references public.vibes(id),
  grouping_policy_id uuid not null references public.grouping_policies(id),
  crowd_mode public.crowd_mode not null default 'everyone',
  min_age integer,
  max_age integer,
  state public.signal_group_state not null default 'forming',
  confirmation_deadline timestamptz,
  coordination_deadline timestamptz,
  formed_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signal_groups_age_check check (
    (min_age is null or min_age >= 18)
    and (
      min_age is null
      or max_age is null
      or max_age >= min_age
    )
  )
);

create table public.signal_group_memberships (
  id uuid primary key default gen_random_uuid(),
  signal_group_id uuid not null references public.signal_groups(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  originating_signal_intent_id uuid references public.signal_intents(id),
  state public.signal_group_membership_state not null default 'matched',
  is_active_core boolean not null default false,
  matched_at timestamptz not null default now(),
  confirmation_deadline timestamptz,
  confirmed_at timestamptz,
  ended_at timestamptz,
  replacement_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint signal_group_memberships_group_user_key
    unique (signal_group_id, user_id),

  constraint signal_group_memberships_active_core_check check (
    not is_active_core
    or state = 'confirmed'
  )
);

-- ============================================================
-- VENUES + COMMERCIAL
-- ============================================================

create table public.venue_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint venue_categories_name_key unique (name),
  constraint venue_categories_slug_key unique (slug)
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id),
  category_id uuid references public.venue_categories(id),
  name text not null,
  address_line1 text,
  address_line2 text,
  postal_code text,
  latitude numeric,
  longitude numeric,
  minimum_age integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venues_minimum_age_check check (
    minimum_age is null or minimum_age >= 0
  )
);

create table public.business_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status public.business_partner_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_partner_venues (
  id uuid primary key default gen_random_uuid(),
  business_partner_id uuid not null references public.business_partners(id) on delete cascade,
  venue_id uuid not null references public.venues(id),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),

  constraint business_partner_venues_validity_check check (
    valid_until is null or valid_until > valid_from
  )
);

create table public.sponsored_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_partner_id uuid not null references public.business_partners(id) on delete cascade,
  venue_id uuid references public.venues(id),
  city_id uuid references public.cities(id),
  activity_id uuid references public.activities(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.sponsored_campaign_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sponsored_campaigns_time_check check (
    ends_at > starts_at
  )
);

-- ============================================================
-- VENUE CANDIDATES
-- plan_id added after plans exists
-- ============================================================

create table public.venue_candidates (
  id uuid primary key default gen_random_uuid(),
  signal_group_id uuid references public.signal_groups(id) on delete cascade,
  plan_id uuid,
  venue_id uuid not null references public.venues(id),
  source public.venue_candidate_source not null,
  sponsored_campaign_id uuid references public.sponsored_campaigns(id),
  suggested_by_user_id uuid references public.user_profiles(user_id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint venue_candidates_context_xor_check check (
    (signal_group_id is not null and plan_id is null)
    or
    (signal_group_id is null and plan_id is not null)
  ),

  constraint venue_candidates_sponsored_integrity_check check (
    (
      source = 'sponsored'
      and sponsored_campaign_id is not null
    )
    or
    (
      source <> 'sponsored'
      and sponsored_campaign_id is null
    )
  ),

  constraint venue_candidates_member_suggestion_integrity_check check (
    (
      source = 'member_suggested'
      and suggested_by_user_id is not null
    )
    or
    (
      source <> 'member_suggested'
      and suggested_by_user_id is null
    )
  )
);

-- ============================================================
-- DECISIONS
-- plan_id and winning_option_id FKs deferred
-- ============================================================

create table public.group_decisions (
  id uuid primary key default gen_random_uuid(),
  signal_group_id uuid references public.signal_groups(id) on delete cascade,
  plan_id uuid,
  type public.decision_type not null,
  state public.decision_state not null default 'open',
  participation_threshold_percent numeric,
  opens_at timestamptz not null,
  deadline_at timestamptz not null,
  finalized_at timestamptz,
  winning_option_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_decisions_context_xor_check check (
    (signal_group_id is not null and plan_id is null)
    or
    (signal_group_id is null and plan_id is not null)
  ),

  constraint group_decisions_deadline_check check (
    deadline_at > opens_at
  ),

  constraint group_decisions_threshold_check check (
    participation_threshold_percent is null
    or (
      participation_threshold_percent > 0
      and participation_threshold_percent <= 100
    )
  )
);

create table public.decision_rounds (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.group_decisions(id) on delete cascade,
  round_number integer not null,
  round_type public.decision_round_type not null,
  state public.decision_state not null default 'open',
  opens_at timestamptz not null,
  deadline_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),

  constraint decision_rounds_decision_number_key
    unique (decision_id, round_number),

  constraint decision_rounds_number_check check (
    round_number > 0
  ),

  constraint decision_rounds_deadline_check check (
    deadline_at > opens_at
  )
);

create table public.decision_options (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.decision_rounds(id) on delete cascade,
  venue_candidate_id uuid references public.venue_candidates(id),
  proposed_time timestamptz,
  applicant_user_id uuid references public.user_profiles(user_id),
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  constraint decision_options_id_round_key unique (id, round_id),

  constraint decision_options_payload_xor_check check (
    (
      case when venue_candidate_id is not null then 1 else 0 end
      +
      case when proposed_time is not null then 1 else 0 end
      +
      case when applicant_user_id is not null then 1 else 0 end
    ) = 1
  )
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  voter_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  option_id uuid not null,
  cast_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint votes_round_voter_key unique (round_id, voter_user_id),

  constraint votes_option_round_fk
    foreign key (option_id, round_id)
    references public.decision_options(id, round_id)
    on delete cascade
);

-- ============================================================
-- PLANS
-- ============================================================

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  origin public.plan_origin not null,
  creator_user_id uuid references public.user_profiles(user_id),
  originating_signal_group_id uuid references public.signal_groups(id),
  city_id uuid not null references public.cities(id),
  activity_id uuid not null references public.activities(id),
  title text,
  description text,
  capacity integer not null,
  crowd_mode public.crowd_mode not null default 'everyone',
  min_age integer,
  max_age integer,
  admission_mode public.admission_mode not null,
  state public.plan_state not null default 'draft',
  current_venue_id uuid references public.venues(id),
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  published_at timestamptz,
  locked_at timestamptz,
  active_outing_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plans_capacity_check check (
    capacity > 0
  ),

  constraint plans_age_check check (
    (min_age is null or min_age >= 18)
    and (
      min_age is null
      or max_age is null
      or max_age >= min_age
    )
  ),

  constraint plans_schedule_check check (
    scheduled_ends_at is null
    or scheduled_starts_at is null
    or scheduled_ends_at > scheduled_starts_at
  ),

  constraint plans_origin_check check (
    (
      origin = 'manual'
      and creator_user_id is not null
      and originating_signal_group_id is null
    )
    or
    (
      origin = 'signal'
      and creator_user_id is null
      and originating_signal_group_id is not null
    )
  ),

  constraint plans_originating_signal_group_key
    unique (originating_signal_group_id)
);

alter table public.venue_candidates
  add constraint venue_candidates_plan_fk
  foreign key (plan_id)
  references public.plans(id)
  on delete cascade;

alter table public.group_decisions
  add constraint group_decisions_plan_fk
  foreign key (plan_id)
  references public.plans(id)
  on delete cascade;

alter table public.group_decisions
  add constraint group_decisions_winning_option_fk
  foreign key (winning_option_id)
  references public.decision_options(id);

-- ============================================================
-- PLAN MEMBERSHIP + ADMISSION
-- ============================================================

create table public.plan_memberships (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  membership_state public.plan_membership_state not null default 'active',
  admission_origin public.admission_origin not null,
  joined_at timestamptz not null default now(),
  locked_member boolean not null default false,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plan_memberships_plan_user_key unique (plan_id, user_id)
);

create table public.admission_requests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  applicant_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  state public.admission_request_state not null default 'pending',
  decision_id uuid references public.group_decisions(id),
  requested_at timestamptz not null default now(),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- PLAN HISTORY
-- ============================================================

create table public.plan_history (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  event_type public.plan_history_event_type not null,
  actor_user_id uuid references public.user_profiles(user_id),
  related_decision_id uuid references public.group_decisions(id),
  previous_venue_id uuid references public.venues(id),
  new_venue_id uuid references public.venues(id),
  previous_starts_at timestamptz,
  new_starts_at timestamptz,
  reason text,
  metadata jsonb,
  occurred_at timestamptz not null default now()
);

-- ============================================================
-- ATTENDANCE
-- ============================================================

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  plan_membership_id uuid not null references public.plan_memberships(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  venue_id uuid references public.venues(id),
  evidence_type public.attendance_evidence_type not null,
  confidence numeric,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint attendance_records_confidence_check check (
    confidence is null
    or (confidence >= 0 and confidence <= 1)
  )
);

-- ============================================================
-- ATTRIBUTION
-- ============================================================

create table public.venue_attribution_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  plan_id uuid references public.plans(id) on delete cascade,
  signal_group_id uuid references public.signal_groups(id) on delete cascade,
  user_id uuid references public.user_profiles(user_id) on delete set null,
  event_type public.attribution_event_type not null,
  journey_origin public.journey_origin,
  candidate_source public.venue_candidate_source,
  sponsored_campaign_id uuid references public.sponsored_campaigns(id),
  occurred_at timestamptz not null default now(),
  metadata jsonb
);

-- ============================================================
-- ECONOMIC IMPACT
-- ============================================================

create table public.spend_benchmarks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id),
  venue_category_id uuid references public.venue_categories(id),
  city_id uuid references public.cities(id),
  amount numeric not null,
  currency_code text not null default 'USD',
  methodology text not null,
  source text not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  created_at timestamptz not null default now(),

  constraint spend_benchmarks_amount_check check (
    amount >= 0
  ),

  constraint spend_benchmarks_validity_check check (
    valid_until is null or valid_until > valid_from
  )
);

create table public.economic_impact_records (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  plan_id uuid not null references public.plans(id) on delete cascade,
  type public.economic_value_type not null,
  amount numeric not null,
  currency_code text not null default 'USD',
  spend_benchmark_id uuid references public.spend_benchmarks(id),
  methodology text not null,
  evidence_reference text,
  calculated_at timestamptz not null default now(),

  constraint economic_impact_records_amount_check check (
    amount >= 0
  )
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  state public.notification_state not null default 'unread',
  related_plan_id uuid references public.plans(id) on delete cascade,
  related_signal_group_id uuid references public.signal_groups(id) on delete cascade,
  related_decision_id uuid references public.group_decisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- ============================================================
-- ADMIN
-- ============================================================

create table public.admin_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  capability text not null,
  granted_at timestamptz not null default now(),
  granted_by_user_id uuid references public.user_profiles(user_id),
  revoked_at timestamptz
);

create table public.administrative_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.user_profiles(user_id),
  capability text not null,
  action_type text not null,
  target_table text,
  target_id uuid,
  reason text,
  metadata jsonb,
  occurred_at timestamptz not null default now()
);

-- ============================================================
-- PARTIAL UNIQUE INDEXES
-- ============================================================

create unique index signal_intents_active_effective_key
  on public.signal_intents (
    user_id,
    city_id,
    activity_id,
    starts_at,
    ends_at,
    crowd_mode
  )
  where state = 'active';

create unique index admission_requests_pending_key
  on public.admission_requests (
    plan_id,
    applicant_user_id
  )
  where state = 'pending';

create unique index admin_grants_active_capability_key
  on public.admin_grants (
    user_id,
    capability
  )
  where revoked_at is null;

-- ============================================================
-- GENERAL QUERY INDEXES
-- ============================================================

create index cities_state_id_idx
  on public.cities(state_id);

create index cities_active_idx
  on public.cities(is_active);

create index city_access_grants_user_city_idx
  on public.city_access_grants(user_id, city_id);

create index activities_category_idx
  on public.activities(category_id);

create index discovery_sessions_user_started_idx
  on public.discovery_sessions(user_id, started_at desc);

create index discovery_interactions_session_occurred_idx
  on public.discovery_interactions(session_id, occurred_at);

create index discovery_interactions_user_occurred_idx
  on public.discovery_interactions(user_id, occurred_at);

create index signal_intents_matching_idx
  on public.signal_intents(
    city_id,
    activity_id,
    state,
    expires_at
  );

create index signal_intents_user_state_idx
  on public.signal_intents(user_id, state);

create index signal_intents_window_idx
  on public.signal_intents(starts_at, ends_at);

create index signal_intent_availability_intent_idx
  on public.signal_intent_availability(signal_intent_id);

create index signal_groups_matching_idx
  on public.signal_groups(
    city_id,
    activity_id,
    state
  );

create index signal_groups_state_expiry_idx
  on public.signal_groups(state, expires_at);

create index signal_group_memberships_group_state_idx
  on public.signal_group_memberships(signal_group_id, state);

create index signal_group_memberships_user_state_idx
  on public.signal_group_memberships(user_id, state);

create index signal_group_memberships_intent_idx
  on public.signal_group_memberships(originating_signal_intent_id);

create index venues_city_category_idx
  on public.venues(city_id, category_id);

create index venues_city_active_idx
  on public.venues(city_id, is_active);

create index sponsored_campaigns_active_window_idx
  on public.sponsored_campaigns(status, starts_at, ends_at);

create index venue_candidates_group_idx
  on public.venue_candidates(signal_group_id);

create index venue_candidates_plan_idx
  on public.venue_candidates(plan_id);

create index group_decisions_group_idx
  on public.group_decisions(signal_group_id);

create index group_decisions_plan_idx
  on public.group_decisions(plan_id);

create index decision_rounds_decision_idx
  on public.decision_rounds(decision_id);

create index decision_options_round_idx
  on public.decision_options(round_id);

create index votes_round_idx
  on public.votes(round_id);

create index plans_city_state_published_idx
  on public.plans(city_id, state, published_at);

create index plans_creator_idx
  on public.plans(creator_user_id);

create index plans_signal_group_idx
  on public.plans(originating_signal_group_id);

create index plans_schedule_idx
  on public.plans(scheduled_starts_at);

create index plan_memberships_plan_state_idx
  on public.plan_memberships(plan_id, membership_state);

create index plan_memberships_user_state_idx
  on public.plan_memberships(user_id, membership_state);

create index admission_requests_plan_state_idx
  on public.admission_requests(plan_id, state);

create index plan_history_plan_occurred_idx
  on public.plan_history(plan_id, occurred_at);

create index attendance_records_plan_user_idx
  on public.attendance_records(plan_id, user_id);

create index venue_attribution_events_venue_event_time_idx
  on public.venue_attribution_events(
    venue_id,
    event_type,
    occurred_at
  );

create index venue_attribution_events_plan_idx
  on public.venue_attribution_events(plan_id);

create index venue_attribution_events_group_idx
  on public.venue_attribution_events(signal_group_id);

create index venue_attribution_events_campaign_idx
  on public.venue_attribution_events(sponsored_campaign_id);

create index economic_impact_records_venue_plan_idx
  on public.economic_impact_records(venue_id, plan_id);

create index notifications_user_state_created_idx
  on public.notifications(user_id, state, created_at desc);

create index administrative_actions_admin_time_idx
  on public.administrative_actions(admin_user_id, occurred_at desc);

commit;
