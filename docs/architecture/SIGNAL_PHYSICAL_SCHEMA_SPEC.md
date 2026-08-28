# SIGNAL — Physical Schema Specification

Status: DRAFT — G3

Source of truth:

- `SIGNAL_PRODUCT_CONTRACT.md`
- `SIGNAL_DATABASE_BLUEPRINT.md`

This document defines the intended physical PostgreSQL structure for migration
0001.

No migration is authorized until this specification is reviewed.

---

## 1. PostgreSQL Conventions

Primary keys use UUID.

Application timestamps use `timestamptz`.

Authoritative rows use database-generated timestamps.

Foreign keys must be explicit.

Critical lifecycle state uses constrained enum/domain values rather than
arbitrary text.

Soft deletion is not the default lifecycle mechanism.

Terminal business records remain historical unless an explicit privacy/legal
workflow requires removal or anonymization.

---

## 2. Required PostgreSQL Extensions

Migration 0001 may require:

- pgcrypto for UUID generation where needed

No extension should be enabled without a concrete schema requirement.

---

## 3. Schema Namespace

Initial application tables live in the `public` schema unless a later security
review proves a dedicated application schema is materially better.

Supabase Auth remains in the managed `auth` schema.

Authentication credentials are never duplicated into public tables.

---

## 4. Enum Inventory

Migration 0001 should define constrained enum types for domain states that are
stable and security-relevant.

Initial enum candidates:

### profile_completion_state

- incomplete
- complete

### entitlement_tier

- free
- pro

### signal_intent_state

- active
- assigned
- withdrawn
- expired

### signal_group_state

- forming
- confirming
- coordinating
- locked
- active_outing
- completed
- cancelled
- expired

### signal_group_membership_state

- matched
- confirmed
- declined
- timed_out
- withdrawn
- replaced

### crowd_mode

- everyone
- women_only
- men_only

### journey_origin

- direct_signal
- im_bored
- manual_plan

### venue_candidate_source

- organic
- member_suggested
- platform_suggested
- sponsored

### plan_origin

- manual
- signal

### admission_mode

- open
- creator_approval
- group_vote

### plan_state

- draft
- published
- locked
- recovery_required
- active_outing
- completed
- cancelled

### admission_request_state

- pending
- approved
- rejected
- expired
- withdrawn

### decision_type

- venue_selection
- time_selection
- plan_admission
- venue_recovery
- reschedule
- cancellation

### decision_state

- open
- final_call
- runoff
- finalized
- cancelled
- expired

### decision_round_type

- primary
- runoff
- final_call

### attendance_evidence_type

- self_reported
- location_supported
- partner_verified
- system_verified

### attribution_event_type

- impression
- view
- vote
- selected
- plan_locked
- directions_opened
- directed
- redirected
- attendance_evidence

### economic_value_type

- estimated_directed
- estimated_attendance
- verified_spend

### notification_state

- unread
- read

Enum use must remain deliberate.

Values expected to evolve frequently should remain configuration rows instead.

---

## 5. states

Authority class: Configuration

Purpose:

Canonical state/region registry.

Columns:

- id uuid primary key
- code text not null
- name text not null
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique code
- unique name

---

## 6. cities

Authority class: Configuration

Purpose:

Canonical city registry.

Columns:

- id uuid primary key
- state_id uuid not null references states
- name text not null
- slug text not null
- latitude numeric nullable
- longitude numeric nullable
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique(state_id, name)
- unique slug where platform-wide slug uniqueness is desired

Indexes:

- state_id
- is_active
- slug

---

## 7. user_profiles

Authority class: Authoritative

Purpose:

Application identity for one Supabase Auth user.

Columns:

- user_id uuid primary key references auth.users(id)
- display_name text nullable until onboarding completes
- avatar_path text nullable until onboarding completes
- bio text nullable
- birth_date date nullable
- home_city_id uuid nullable references cities
- completion_state profile_completion_state not null default incomplete
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

When completion_state = complete:

- display_name must be present
- avatar_path must be present
- home_city_id must be present

Raw birth_date remains private.

No admin role or entitlement flag belongs here.

---

## 8. account_entitlements

Authority class: Authoritative Security

Purpose:

Current access tier.

Columns:

- user_id uuid primary key references user_profiles
- tier entitlement_tier not null default free
- valid_from timestamptz not null
- valid_until timestamptz nullable
- source text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

valid_until > valid_from when valid_until is not null.

---

## 9. city_access_grants

Authority class: Authoritative Security

Purpose:

Explicit city access beyond ordinary home-city rights.

Columns:

- id uuid primary key
- user_id uuid not null references user_profiles
- city_id uuid not null references cities
- valid_from timestamptz not null
- valid_until timestamptz nullable
- source text not null
- created_at timestamptz not null

Constraints:

- unique active user/city grant policy to be finalized in migration design
- valid_until > valid_from when present

---

## 10. activity_categories

Authority class: Configuration

Columns:

- id uuid primary key
- name text not null
- slug text not null
- sort_order integer not null default 0
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique name
- unique slug

---

## 11. activities

Authority class: Configuration

Columns:

- id uuid primary key
- category_id uuid not null references activity_categories
- name text not null
- slug text not null
- default_min_group integer nullable
- default_target_group integer nullable
- default_max_group integer nullable
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique slug
- group sizes positive where provided
- min <= target <= max where all provided

---

## 12. vibes

Authority class: Configuration

Columns:

- id uuid primary key
- name text not null
- slug text not null
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique name
- unique slug

---

## 13. discovery_options

Authority class: Configuration

Purpose:

Configurable I'M BORED choices.

Columns:

- id uuid primary key
- label text not null
- option_type text not null
- activity_id uuid nullable references activities
- activity_category_id uuid nullable references activity_categories
- vibe_id uuid nullable references vibes
- metadata jsonb nullable
- sort_order integer not null default 0
- is_active boolean not null default true
- created_at timestamptz not null

Rule:

Critical domain meaning must not depend only on opaque metadata.

---

## 14. discovery_sessions

Authority class: Historical / Analytical

Columns:

- id uuid primary key
- user_id uuid not null references user_profiles
- started_at timestamptz not null
- ended_at timestamptz nullable
- created_signal_intent_id uuid nullable
- created_at timestamptz not null

The Signal Intent FK may be added after signal_intents exists to avoid circular
migration dependency.

---

## 15. discovery_interactions

Authority class: Historical / Analytical

Columns:

- id uuid primary key
- session_id uuid not null references discovery_sessions
- user_id uuid not null references user_profiles
- discovery_option_id uuid nullable references discovery_options
- interaction_type text not null
- occurred_at timestamptz not null
- metadata jsonb nullable

Indexes:

- session_id, occurred_at
- user_id, occurred_at

---

## 16. grouping_policies

Authority class: Configuration

Columns:

- id uuid primary key
- code text not null
- version integer not null
- activation_threshold integer not null
- target_capacity integer not null
- max_capacity integer not null
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique(code, version)
- activation_threshold > 0
- activation_threshold <= target_capacity
- target_capacity <= max_capacity

Initial policy:

4 / 6 / 6

---

## 17. signal_intents

Authority class: Authoritative + Historical Lifecycle

Columns:

- id uuid primary key
- user_id uuid not null references user_profiles
- city_id uuid not null references cities
- activity_id uuid not null references activities
- vibe_id uuid nullable references vibes
- crowd_mode crowd_mode not null default everyone
- min_age integer nullable
- max_age integer nullable
- preferred_radius_miles numeric nullable
- starts_at timestamptz not null
- ends_at timestamptz not null
- expires_at timestamptz not null
- state signal_intent_state not null
- journey_origin journey_origin not null
- discovery_session_id uuid nullable references discovery_sessions
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- ends_at > starts_at
- expires_at >= starts_at
- min_age >= 18 where present under initial product policy
- max_age >= min_age where both present
- preferred_radius_miles > 0 where present

Indexes:

- active matching composite on city/activity/state/expires_at
- user_id/state
- starts_at/ends_at

Duplicate active-intent prevention will use controlled operation plus a
targeted partial uniqueness strategy finalized in migration design.

---

## 18. signal_intent_availability

Authority class: Authoritative

Columns:

- id uuid primary key
- signal_intent_id uuid not null references signal_intents
- starts_at timestamptz not null
- ends_at timestamptz not null
- is_hard boolean not null default true
- created_at timestamptz not null

Constraints:

- ends_at > starts_at

Index:

- signal_intent_id

---

## 19. signal_groups

Authority class: Authoritative + Historical Lifecycle

Columns:

- id uuid primary key
- city_id uuid not null references cities
- activity_id uuid not null references activities
- vibe_id uuid nullable references vibes
- grouping_policy_id uuid not null references grouping_policies
- crowd_mode crowd_mode not null
- min_age integer nullable
- max_age integer nullable
- state signal_group_state not null
- confirmation_deadline timestamptz nullable
- coordination_deadline timestamptz nullable
- formed_at timestamptz not null
- locked_at timestamptz nullable
- completed_at timestamptz nullable
- cancelled_at timestamptz nullable
- expires_at timestamptz not null
- created_at timestamptz not null
- updated_at timestamptz not null

No owner_id.

Indexes:

- city_id/activity_id/state
- state/expires_at

---

## 20. signal_group_memberships

Authority class: Authoritative + Historical Lifecycle

Columns:

- id uuid primary key
- signal_group_id uuid not null references signal_groups
- user_id uuid not null references user_profiles
- originating_signal_intent_id uuid nullable references signal_intents
- state signal_group_membership_state not null
- is_active_core boolean not null default false
- matched_at timestamptz not null
- confirmation_deadline timestamptz nullable
- confirmed_at timestamptz nullable
- ended_at timestamptz nullable
- replacement_reason text nullable
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- unique(signal_group_id, user_id)
- is_active_core implies confirmed state through domain enforcement/check design

Indexes:

- signal_group_id/state
- user_id/state
- originating_signal_intent_id

---

## 21. venue_categories

Authority class: Configuration

Columns:

- id uuid primary key
- name text not null
- slug text not null
- is_active boolean not null default true
- created_at timestamptz not null

Constraints:

- unique name
- unique slug

---

## 22. venues

Authority class: Configuration / Platform Reference

Columns:

- id uuid primary key
- city_id uuid not null references cities
- category_id uuid nullable references venue_categories
- name text not null
- address_line1 text nullable
- address_line2 text nullable
- postal_code text nullable
- latitude numeric nullable
- longitude numeric nullable
- minimum_age integer nullable
- is_active boolean not null default true
- created_at timestamptz not null
- updated_at timestamptz not null

Indexes:

- city_id/category_id
- city_id/is_active

---

## 23. business_partners

Authority class: Authoritative Commercial

Columns:

- id uuid primary key
- name text not null
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

---

## 24. business_partner_venues

Authority class: Authoritative Commercial Relationship

Columns:

- id uuid primary key
- business_partner_id uuid not null references business_partners
- venue_id uuid not null references venues
- valid_from timestamptz not null
- valid_until timestamptz nullable
- created_at timestamptz not null

Constraints:

- valid_until > valid_from where present

---

## 25. sponsored_campaigns

Authority class: Authoritative + Historical Commercial

Columns:

- id uuid primary key
- business_partner_id uuid not null references business_partners
- venue_id uuid nullable references venues
- city_id uuid nullable references cities
- activity_id uuid nullable references activities
- starts_at timestamptz not null
- ends_at timestamptz not null
- status text not null
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- ends_at > starts_at

---

## 26. venue_candidates

Authority class: Authoritative Coordination

Columns:

- id uuid primary key
- signal_group_id uuid nullable references signal_groups
- plan_id uuid nullable
- venue_id uuid not null references venues
- source venue_candidate_source not null
- sponsored_campaign_id uuid nullable references sponsored_campaigns
- suggested_by_user_id uuid nullable references user_profiles
- is_active boolean not null default true
- created_at timestamptz not null

Rule:

Exactly one coordination context must exist:

- signal_group_id
or
- plan_id

The plan FK is added after plans exists.

---

## 27. group_decisions

Authority class: Authoritative + Historical

Columns:

- id uuid primary key
- signal_group_id uuid nullable references signal_groups
- plan_id uuid nullable
- type decision_type not null
- state decision_state not null
- participation_threshold_percent numeric nullable
- opens_at timestamptz not null
- deadline_at timestamptz not null
- finalized_at timestamptz nullable
- winning_option_id uuid nullable
- created_at timestamptz not null
- updated_at timestamptz not null

Rule:

Exactly one decision context must be present:

- signal_group
or
- plan

Foreign keys to plan and winning option may be added after dependency creation.

---

## 28. decision_rounds

Authority class: Authoritative + Historical

Columns:

- id uuid primary key
- decision_id uuid not null references group_decisions
- round_number integer not null
- round_type decision_round_type not null
- state decision_state not null
- opens_at timestamptz not null
- deadline_at timestamptz not null
- finalized_at timestamptz nullable
- created_at timestamptz not null

Constraints:

- unique(decision_id, round_number)
- round_number > 0
- deadline_at > opens_at

---

## 29. decision_options

Authority class: Authoritative

Columns:

- id uuid primary key
- round_id uuid not null references decision_rounds
- venue_candidate_id uuid nullable references venue_candidates
- proposed_time timestamptz nullable
- applicant_user_id uuid nullable references user_profiles
- label text nullable
- sort_order integer not null default 0
- created_at timestamptz not null

Rule:

A decision option must have exactly one typed option payload appropriate to the
parent decision type.

Critical truth must not depend only on label text.

---

## 30. votes

Authority class: Authoritative + Historical

Columns:

- id uuid primary key
- round_id uuid not null references decision_rounds
- voter_user_id uuid not null references user_profiles
- option_id uuid not null references decision_options
- cast_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- unique(round_id, voter_user_id)

Additional validation:

option_id must belong to the same round.

That requires controlled function/trigger-level validation because a simple FK
cannot express the cross-row rule unless composite keys are used.

---

## 31. plans

Authority class: Authoritative + Historical Lifecycle

Columns:

- id uuid primary key
- origin plan_origin not null
- creator_user_id uuid nullable references user_profiles
- originating_signal_group_id uuid nullable references signal_groups
- city_id uuid not null references cities
- activity_id uuid not null references activities
- title text nullable
- description text nullable
- capacity integer not null
- crowd_mode crowd_mode not null default everyone
- min_age integer nullable
- max_age integer nullable
- admission_mode admission_mode not null
- state plan_state not null
- current_venue_id uuid nullable references venues
- scheduled_starts_at timestamptz nullable
- scheduled_ends_at timestamptz nullable
- published_at timestamptz nullable
- locked_at timestamptz nullable
- active_outing_at timestamptz nullable
- completed_at timestamptz nullable
- cancelled_at timestamptz nullable
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- capacity > 0
- scheduled_ends_at > scheduled_starts_at when both present
- min_age <= max_age when both present
- manual origin requires creator
- signal origin requires originating Signal Group
- manual origin must not require fake Signal Group
- signal origin must not require fake creator
- originating_signal_group_id unique where present

Indexes:

- city/state/published
- creator_user_id
- originating_signal_group_id
- scheduled_starts_at

---

## 32. plan_memberships

Authority class: Authoritative + Historical

Columns:

- id uuid primary key
- plan_id uuid not null references plans
- user_id uuid not null references user_profiles
- membership_state text not null
- admission_origin text not null
- joined_at timestamptz not null
- locked_member boolean not null default false
- withdrawn_at timestamptz nullable
- created_at timestamptz not null
- updated_at timestamptz not null

Constraints:

- unique(plan_id, user_id)

Current occupancy counts only membership states considered active by domain
policy.

Membership_state will be converted to a constrained enum before migration 0001
is approved.

---

## 33. admission_requests

Authority class: Authoritative + Historical

Columns:

- id uuid primary key
- plan_id uuid not null references plans
- applicant_user_id uuid not null references user_profiles
- state admission_request_state not null
- decision_id uuid nullable references group_decisions
- requested_at timestamptz not null
- finalized_at timestamptz nullable
- created_at timestamptz not null
- updated_at timestamptz not null

Active duplicate request prevention requires targeted uniqueness.

---

## 34. plan_history

Authority class: Historical

Columns:

- id uuid primary key
- plan_id uuid not null references plans
- event_type text not null
- actor_user_id uuid nullable references user_profiles
- related_decision_id uuid nullable references group_decisions
- previous_venue_id uuid nullable references venues
- new_venue_id uuid nullable references venues
- previous_starts_at timestamptz nullable
- new_starts_at timestamptz nullable
- reason text nullable
- metadata jsonb nullable
- occurred_at timestamptz not null

Critical transition meaning must remain explicit through typed columns/event
types, not only metadata.

---

## 35. attendance_records

Authority class: Authoritative Evidence / Analytical

Columns:

- id uuid primary key
- plan_id uuid not null references plans
- plan_membership_id uuid not null references plan_memberships
- user_id uuid not null references user_profiles
- venue_id uuid nullable references venues
- evidence_type attendance_evidence_type not null
- confidence numeric nullable
- occurred_at timestamptz not null
- created_at timestamptz not null

Constraints:

- confidence between 0 and 1 where present

V1 may allow multiple evidence rows per member.

Aggregation must avoid double counting.

---

## 36. venue_attribution_events

Authority class: Historical / Analytical

Columns:

- id uuid primary key
- venue_id uuid not null references venues
- plan_id uuid nullable references plans
- signal_group_id uuid nullable references signal_groups
- user_id uuid nullable references user_profiles
- event_type attribution_event_type not null
- journey_origin journey_origin nullable
- candidate_source venue_candidate_source nullable
- sponsored_campaign_id uuid nullable references sponsored_campaigns
- occurred_at timestamptz not null
- metadata jsonb nullable

Indexes:

- venue_id/event_type/occurred_at
- plan_id
- signal_group_id
- sponsored_campaign_id

---

## 37. spend_benchmarks

Authority class: Configuration / Analytical

Columns:

- id uuid primary key
- venue_id uuid nullable references venues
- venue_category_id uuid nullable references venue_categories
- city_id uuid nullable references cities
- amount numeric not null
- currency_code text not null default 'USD'
- methodology text not null
- source text not null
- valid_from timestamptz not null
- valid_until timestamptz nullable
- created_at timestamptz not null

Constraints:

- amount >= 0
- valid_until > valid_from where present

---

## 38. economic_impact_records

Authority class: Historical / Analytical

Columns:

- id uuid primary key
- venue_id uuid not null references venues
- plan_id uuid not null references plans
- type economic_value_type not null
- amount numeric not null
- currency_code text not null default 'USD'
- spend_benchmark_id uuid nullable references spend_benchmarks
- methodology text not null
- evidence_reference text nullable
- calculated_at timestamptz not null

Constraints:

- amount >= 0

Uniqueness/idempotency strategy must prevent duplicate impact records for the
same calculation basis.

---

## 39. notifications

Authority class: Authoritative Delivery State / Historical

Columns:

- id uuid primary key
- user_id uuid not null references user_profiles
- type text not null
- title text not null
- body text nullable
- state notification_state not null default unread
- related_plan_id uuid nullable references plans
- related_signal_group_id uuid nullable references signal_groups
- related_decision_id uuid nullable references group_decisions
- created_at timestamptz not null
- read_at timestamptz nullable

Indexes:

- user_id/state/created_at

---

## 40. admin_grants

Authority class: Authoritative Security

Columns:

- id uuid primary key
- user_id uuid not null references user_profiles
- capability text not null
- granted_at timestamptz not null
- granted_by_user_id uuid nullable references user_profiles
- revoked_at timestamptz nullable

Constraints:

- controlled uniqueness for active user/capability grant

Admin capability is not stored in user_profiles.

---

## 41. administrative_actions

Authority class: Historical / Audit

Columns:

- id uuid primary key
- admin_user_id uuid not null references user_profiles
- capability text not null
- action_type text not null
- target_table text nullable
- target_id uuid nullable
- reason text nullable
- metadata jsonb nullable
- occurred_at timestamptz not null

This is audit history, not authority.

---

## 42. Dependency Order

Migration 0001 table creation should proceed approximately:

1. enum types
2. states
3. cities
4. user_profiles
5. account_entitlements
6. city_access_grants
7. activity_categories
8. activities
9. vibes
10. discovery_options
11. grouping_policies
12. discovery_sessions
13. discovery_interactions
14. signal_intents
15. signal_intent_availability
16. signal_groups
17. signal_group_memberships
18. venue_categories
19. venues
20. business_partners
21. business_partner_venues
22. sponsored_campaigns
23. venue_candidates with deferred Plan FK
24. group_decisions with deferred Plan/winning-option FK
25. decision_rounds
26. decision_options
27. votes
28. plans
29. deferred venue_candidate.plan_id FK
30. deferred group_decisions.plan_id FK
31. deferred group_decisions.winning_option_id FK
32. plan_memberships
33. admission_requests
34. plan_history
35. attendance_records
36. venue_attribution_events
37. spend_benchmarks
38. economic_impact_records
39. notifications
40. admin_grants
41. administrative_actions
42. deferred discovery_sessions.created_signal_intent_id FK

Exact ordering may be refined to eliminate unnecessary deferred constraints.

---

## 43. Tables Deferred From Migration 0001

The following do not require physical V1 tables yet:

- signal_pool
- profile_media
- neighborhood_area
- generic time_proposal
- generic plan_change_request

They may be introduced later only when proven necessary.

---

## 44. Migration 0001 Scope Principle

Migration 0001 should establish:

- identities
- canonical geography
- entitlements
- activity/discovery configuration
- Signal intent
- groups and group membership
- availability
- venues
- decisions/votes
- Plans
- Plan membership/admission
- Plan history
- attendance evidence
- attribution/economic-impact rails
- notifications
- admin capability/audit

Migration 0001 should NOT yet attempt to implement every domain function,
Realtime publication, Storage policy, seed registry, or advanced analytical
pipeline.

Those belong to subsequent gated migrations.

---

## 45. Required Schema Corrections Before SQL

Before migration 0001 is written, G3 must explicitly resolve:

1. plan_membership_state enum

2. business_partner status enum or constrained configuration

3. sponsored_campaign status enum

4. exact active Signal Intent uniqueness strategy

5. exact active Admission Request uniqueness strategy

6. exact active Admin Grant uniqueness strategy

7. typed enforcement for decision options

8. cross-round Vote option validation strategy

9. venue_candidate context XOR constraint

10. group_decision context XOR constraint

11. Plan origin XOR constraints

12. active-core membership constraint

13. Plan capacity enforcement remains function/transaction owned rather than
    table CHECK

14. sensitive public/private profile projection strategy

These must be settled before SQL generation.

---

## 46. G3.0 Status

The physical schema candidate is defined.

No migration has been generated yet.

Migration 0001 is NOT authorized until the fourteen required schema corrections
in Section 45 are resolved.

Next gate:

G3.1 — Resolve Physical Constraints + Enum Closure.


---

## 47. plan_membership_state Enum

Migration 0001 will define:

plan_membership_state

Values:

- active
- withdrawn
- removed
- completed

Meaning:

active:
currently counts toward Plan occupancy.

withdrawn:
member voluntarily left.

removed:
member was removed through an authorized domain operation.

completed:
historical membership after Plan completion where lifecycle policy explicitly
transitions membership.

Current occupancy includes only `active`.

Historical membership rows remain preserved.

---

## 48. admission_origin Enum

Migration 0001 will define:

admission_origin

Values:

- creator
- signal_lock
- open_join
- creator_approval
- group_vote
- post_lock_admission
- admin_correction

Purpose:

Preserves how a Plan Membership became authoritative.

This is distinct from Plan admission_mode.

---

## 49. Business Partner Status

Migration 0001 will define:

business_partner_status

Values:

- pending
- active
- suspended
- ended

This status controls the commercial relationship lifecycle.

Venue identity remains valid even when the commercial relationship is inactive.

---

## 50. Sponsored Campaign Status

Migration 0001 will define:

sponsored_campaign_status

Values:

- draft
- scheduled
- active
- paused
- completed
- cancelled

Campaign lifecycle is explicit.

Sponsored Campaign state must not be inferred merely from current time.

System operations may transition scheduled/active/completed state according to
policy.

---

## 51. Active Signal Intent Uniqueness

Migration 0001 will enforce duplicate-active-intent protection through a
partial unique index.

Initial effective duplicate scope:

- user_id
- city_id
- activity_id
- starts_at
- ends_at
- crowd_mode

where:

state = active

This does not prohibit a user from holding unrelated active intents.

It prevents identical effective active intent from being created repeatedly.

Vibe and radius are not included in the initial uniqueness identity because
they are preference dimensions that may be updated through the controlled
intent operation rather than used to manufacture parallel duplicate intent.

System/domain operations remain responsible for lifecycle validation beyond
the uniqueness constraint.

---

## 52. Active Admission Request Uniqueness

Migration 0001 will enforce:

At most one `pending` Admission Request for the same:

- plan_id
- applicant_user_id

using a partial unique index.

Historical approved/rejected/expired/withdrawn requests remain preserved.

A future request may be created after a previous request reaches terminal state
where product policy permits.

---

## 53. Active Admin Grant Uniqueness

Migration 0001 will enforce:

At most one active admin capability grant for the same:

- user_id
- capability

where:

revoked_at IS NULL

Historical revoked grants remain preserved.

---

## 54. Typed Decision Option Enforcement

Decision Option will support these typed payload columns:

- venue_candidate_id
- proposed_time
- applicant_user_id

Migration 0001 will enforce that exactly one typed payload is populated.

Conceptually:

number_of_non_null(
  venue_candidate_id,
  proposed_time,
  applicant_user_id
) = 1

Label is presentation metadata.

Label does not count as a typed authoritative payload.

Decision type compatibility cannot be safely enforced with a simple local CHECK
because the parent Decision type lives through Decision Round → Decision.

That validation belongs to controlled Decision Option creation/finalization
operations.

Migration 0001 will still enforce the local XOR constraint.

---

## 55. Vote Option / Round Integrity

Migration 0001 will use a composite referential strategy.

Decision Options will expose a unique composite key:

- id
- round_id

Votes will carry:

- option_id
- round_id

and use a composite foreign key:

(option_id, round_id)
→ decision_options(id, round_id)

This guarantees at the relational level that a Vote cannot reference an option
from another Decision Round.

The ordinary foreign relationship to round_id remains conceptually present
through that same constraint.

---

## 56. Venue Candidate Context XOR

Venue Candidate belongs to exactly one coordination context.

Migration 0001 will enforce:

exactly one of:

- signal_group_id
- plan_id

is non-null.

This is a database CHECK invariant.

A Venue Candidate cannot simultaneously belong to both.

A Venue Candidate cannot belong to neither.

---

## 57. Group Decision Context XOR

Group Decision belongs to exactly one authoritative context.

Migration 0001 will enforce:

exactly one of:

- signal_group_id
- plan_id

is non-null.

A Group Decision cannot simultaneously belong to both.

A Group Decision cannot belong to neither.

---

## 58. Plan Origin Constraint

Migration 0001 will enforce Plan origin structurally.

For:

origin = manual

Required:

- creator_user_id IS NOT NULL
- originating_signal_group_id IS NULL

For:

origin = signal

Required:

- creator_user_id IS NULL
- originating_signal_group_id IS NOT NULL

No fake creator.

No fake Signal Group.

Additionally:

originating_signal_group_id remains unique where non-null so one Signal Group
cannot produce multiple authoritative Plans under the initial model.

---

## 59. Active-Core Membership Constraint

Migration 0001 will enforce:

is_active_core = true

only when:

state = confirmed

This can be enforced locally through a CHECK constraint.

The database cannot determine the full four-member active-core threshold through
one row CHECK.

The transition establishing the active core remains a controlled domain
operation that validates the group-wide confirmed count.

---

## 60. Plan Capacity Enforcement

Plan capacity cannot be safely enforced by a simple Plan table CHECK because
occupancy lives in Plan Membership rows.

Migration 0001 will enforce only:

capacity > 0

Plan admission and Plan Lock operations will enforce occupancy atomically.

Direct Plan Membership insertion by ordinary clients will be prohibited.

Capacity correctness therefore depends on:

- Plan constraint
- membership uniqueness
- controlled membership operations
- transaction/locking strategy

This is intentional.

No denormalized authoritative occupancy count will be added to Plan.

---

## 61. Public / Private Profile Strategy

Migration 0001 will keep authoritative profile data in `user_profiles`.

Ordinary cross-user reads must not expose private columns directly.

The initial strategy will be:

### user_profiles

Authoritative table containing both public and private application profile
fields.

Client access:

- user may read their own permitted full profile
- ordinary users do not receive unrestricted SELECT on private profile rows

### public_profiles

A database view/projection exposing only public-safe fields required by social
surfaces.

Initial public-safe projection:

- user_id
- display_name
- avatar_path
- bio
- home_city_id
- derived age where birth_date exists

Raw `birth_date` is excluded.

Administrative/security/internal fields are excluded.

Age must be calculated from birth_date by PostgreSQL rather than stored as an
independently editable authoritative integer.

RLS/view access strategy will be implemented and tested in later migration/RLS
gates.

---

## 62. Discovery Session Circular Reference

`discovery_sessions.created_signal_intent_id` references `signal_intents`.

`signal_intents.discovery_session_id` references `discovery_sessions`.

Migration 0001 will avoid dependency ambiguity by:

1. create discovery_sessions without created_signal_intent_id FK initially
2. create signal_intents with discovery_session_id FK
3. add discovery_sessions.created_signal_intent_id
4. add its FK after signal_intents exists

Both relationships are nullable.

The relationship represents:

Discovery Session
→ optional resulting Signal Intent

and:

Signal Intent
→ optional discovery origin session

Domain operations must keep these consistent where both are populated.

---

## 63. Plan Membership Constraint Closure

`plan_memberships.membership_state` will use:

plan_membership_state

`plan_memberships.admission_origin` will use:

admission_origin

Migration 0001 will therefore not use unconstrained text for either field.

Current occupancy means:

membership_state = active

The domain operation performing Plan completion may preserve active membership
or transition to completed according to later lifecycle implementation.

The database architecture does not depend on deleting membership.

---

## 64. Commercial Status Constraint Closure

`business_partners.status` will use:

business_partner_status

`sponsored_campaigns.status` will use:

sponsored_campaign_status

Migration 0001 will not leave these as arbitrary text.

---

## 65. Plan History Event Type

Migration 0001 will define:

plan_history_event_type

Initial values:

- created
- published
- locked
- member_withdrew
- member_removed
- member_admitted
- seat_reopened
- venue_recovery_started
- venue_changed
- reschedule_started
- time_changed
- recovery_required
- recovery_resolved
- active_outing
- cancelled
- completed
- admin_corrected

This gives meaningful history a constrained event identity.

`plan_history.event_type` will use this enum.

Metadata remains supplemental rather than the sole meaning of the event.

---

## 66. Discovery Interaction Type

Migration 0001 will define:

discovery_interaction_type

Initial values:

- selected
- passed
- skipped
- surprise_me

`discovery_interactions.interaction_type` will use this enum.

Future interaction types require explicit schema evolution rather than arbitrary
untrusted text becoming analytical meaning.

---

## 67. Notification Type Strategy

Notification type is expected to evolve frequently.

Migration 0001 will NOT make notification `type` a PostgreSQL enum.

It remains constrained application/system text generated only by trusted
domain/system operations.

Ordinary users cannot create system notifications.

This avoids frequent enum migrations for presentation-oriented notification
categories.

---

## 68. Capability Strategy

Admin capability values are expected to evolve.

Migration 0001 will keep `admin_grants.capability` as text.

Security does not depend on arbitrary client input because ordinary users have
no write authority to Admin Grants.

Administrative capability validation belongs to trusted admin/domain
operations.

A dedicated capability registry may be introduced later if necessary.

---

## 69. Sponsor Source Integrity

Venue Candidate source and Sponsored Campaign relationship must remain
consistent.

Migration/domain rules require:

If:

source = sponsored

then:

sponsored_campaign_id must be non-null.

If:

source != sponsored

then:

sponsored_campaign_id should be null under the initial model.

This relationship will be enforced by a CHECK constraint.

Member-suggested candidate policy may similarly require
`suggested_by_user_id`, enforced where practical.

---

## 70. Member Suggestion Integrity

Under initial Venue Candidate rules:

If:

source = member_suggested

then:

suggested_by_user_id must be non-null.

For:

organic
platform_suggested
sponsored

suggested_by_user_id should be null.

This is enforceable through a local CHECK constraint.

Authorization that the suggested user is actually eligible in the associated
group/Plan remains a controlled domain-operation concern.

---

## 71. Age Constraint Closure

Where age ranges exist:

- min_age must be >= 18 when non-null under initial social-product policy
- max_age must be >= min_age where both are present

Venue minimum_age:

- must be >= 0 where present

A venue minimum age such as 21 is mandatory eligibility context.

The database does not expose raw birth_date merely to enforce these rules.

---

## 72. Timestamp Constraint Closure

Migration 0001 will enforce local timestamp sanity where possible.

Examples:

Signal Intent:

- ends_at > starts_at
- expires_at >= starts_at

Availability:

- ends_at > starts_at

Decision Round:

- deadline_at > opens_at

Sponsored Campaign:

- ends_at > starts_at

Spend Benchmark:

- valid_until > valid_from where non-null

Account Entitlement:

- valid_until > valid_from where non-null

City Access Grant:

- valid_until > valid_from where non-null

Business Partner Venue:

- valid_until > valid_from where non-null

Plan:

- scheduled_ends_at > scheduled_starts_at where both non-null

Cross-lifecycle timestamp sequencing that depends on state transitions remains
owned by controlled operations.

---

## 73. UUID Generation Strategy

Migration 0001 will use database-generated UUID defaults for application-owned
UUID primary keys.

Supabase Auth user identity continues to originate from auth.users.

`user_profiles.user_id` uses the Auth UUID directly rather than generating a
second application user identity.

---

## 74. Updated Migration Dependency Order

After G3.1 closure, migration 0001 dependency order is:

1. required extension(s)

2. enum types

3. states

4. cities

5. user_profiles

6. public_profiles projection/view after base profile structure exists

7. account_entitlements

8. city_access_grants

9. activity_categories

10. activities

11. vibes

12. discovery_options

13. grouping_policies

14. discovery_sessions

15. discovery_interactions

16. signal_intents

17. add discovery_sessions.created_signal_intent_id relationship

18. signal_intent_availability

19. signal_groups

20. signal_group_memberships

21. venue_categories

22. venues

23. business_partners

24. business_partner_venues

25. sponsored_campaigns

26. venue_candidates initially with nullable Plan relationship deferred as
    required

27. group_decisions initially with Plan/winning option dependencies deferred

28. decision_rounds

29. decision_options

30. votes using composite option/round integrity

31. plans

32. add deferred Venue Candidate Plan FK

33. add deferred Group Decision Plan FK

34. add deferred Group Decision winning option FK

35. plan_memberships

36. admission_requests

37. plan_history

38. attendance_records

39. venue_attribution_events

40. spend_benchmarks

41. economic_impact_records

42. notifications

43. admin_grants

44. administrative_actions

45. indexes/partial unique indexes that depend on all required columns

46. final local cross-field constraints not already created inline

47. schema verification queries/tests

RLS, controlled functions, Realtime, Storage and production seed data remain
separate gated implementation steps after the structural migration is verified.

---

## 75. Migration 0001 Constraint Inventory

Migration 0001 must implement structural enforcement for at least:

- profile completion requirements
- canonical foreign keys
- timestamp ordering
- age-range validity
- grouping-policy size ordering
- duplicate group membership
- active-core implies confirmed
- Venue Candidate context XOR
- Group Decision context XOR
- Decision Option typed payload XOR
- Vote option belongs to same round
- Plan origin relationship
- one Signal Group → at most one Plan
- Plan capacity positive
- duplicate Plan membership
- pending Admission Request uniqueness
- active Signal Intent duplicate protection
- active Admin Grant uniqueness
- sponsored candidate campaign integrity
- member-suggested candidate user integrity
- constrained commercial statuses
- constrained membership/admission/history states

Capacity under concurrency remains owned by controlled operations.

Group seat capacity under concurrency remains owned by controlled operations.

Vote eligibility/finalization remains owned by controlled operations.

---

## 76. G3.1 Closure

All fourteen blockers identified in G3.0 Section 45 are now resolved.

Additionally, G3.1 closes:

- Plan membership state
- admission origin
- Plan history event type
- discovery interaction type
- commercial lifecycle statuses
- public/private profile projection
- decision-option relational integrity
- sponsorship candidate integrity
- member suggestion integrity
- UUID strategy
- refined dependency order

The physical structure is now sufficiently specified to generate migration
0001.

Next gate:

G3.2 — Generate Migration 0001 Structural Foundation.
