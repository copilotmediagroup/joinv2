# SIGNAL — Greenfield Database Blueprint

Status: DRAFT

Source of truth:

`docs/architecture/SIGNAL_PRODUCT_CONTRACT.md`

This document translates the frozen G1 product/domain contract into database
architecture.

This is not a migration.

This document must be reviewed and locked before migration 0001 is written.

---

## 1. Database Architecture Principles

SIGNAL uses PostgreSQL/Supabase as the authoritative domain boundary.

The database must enforce critical product invariants rather than trusting the
frontend to enforce them.

The architecture follows these rules:

- frontend state is untrusted
- Supabase Auth owns authentication identity
- PostgreSQL owns authoritative application state
- RLS protects client-accessible data
- controlled database operations own critical transitions
- concurrency-sensitive actions must be atomic
- historical truth must not be silently overwritten
- Realtime distributes committed truth
- Realtime does not create truth
- recommendation algorithms remain replaceable
- grouping algorithms remain replaceable
- no fake ownership is introduced merely to simplify schema design

---

## 2. Major Database Domains

The initial database architecture is divided conceptually into:

1. Identity and Profiles
2. Geography
3. Subscription and City Entitlements
4. Activities and Discovery Taxonomy
5. I'M BORED Discovery
6. Signal Intent
7. Signal Pools and Matching
8. Signal Groups
9. Group Membership
10. Availability and Time Coordination
11. Venue Discovery and Candidates
12. Voting and Decisions
13. Unified Plans
14. Plan Membership and Admission
15. Plan Recovery and Rescheduling
16. Attendance
17. Venue Attribution
18. Economic Impact
19. Notifications
20. Administration
21. Audit and Historical Events

These are domain boundaries.

They do not imply one table per item.

---

## 3. Identity Boundary

Authentication identity belongs to Supabase Auth.

Application profile data belongs to the SIGNAL application schema.

The architecture must not duplicate password or authentication credential
storage.

Application identity must reference the authenticated Supabase user.

Profile data may include applicable product fields such as:

- display name
- profile photo reference
- bio
- private birth date
- derived/public age representation
- home city
- onboarding state
- other permitted profile attributes

Raw birthday is private authoritative data.

Public profile surfaces must not require exposing raw birthday.

---

## 4. Geography Boundary

SIGNAL requires authoritative geographic entities rather than free-form city
strings for core domain behavior.

The geography model must support at least:

- state
- city
- city/state relationship
- stable city identity
- active/inactive platform availability
- future geographic metadata

User home-city selection must reference authoritative geography.

Signal intent, city timelines, Plan creation and city entitlement must use
stable geographic identity.

---

## 5. Entitlement Boundary

City access is an entitlement concern.

The architecture must be capable of distinguishing:

- home city
- cities a user may discover
- cities a user may create Plans within
- Free entitlement
- Pro/multi-city entitlement
- future subscription policies

Entitlement policy must not depend solely on hidden frontend navigation.

Direct database/API access must not permit unauthorized city access.

---

## 6. Activity and Discovery Taxonomy

Activities and discovery choices require stable domain representation.

The architecture must support concepts such as:

- activity categories
- activities
- vibes
- discovery prompts/options
- venue-category relationships
- future taxonomy expansion

The database must not hard-code the permanent I'M BORED experience into one
fixed sequence of questions.

Discovery presentation remains replaceable.

Stable activity identity must remain usable by Signal intent and matching.

---

## 7. I'M BORED Discovery Boundary

I'M BORED is an entry path into the existing Signal domain.

The architecture may preserve discovery interactions for:

- recommendation
- analytics
- attribution
- conversion analysis

Discovery history is not equivalent to active Signal intent.

The architecture must distinguish:

- discovery interaction
- discovered preference
- active authoritative intent
- journey origin

I'M BORED must not create a second matching architecture.

---

## 8. Signal Intent Boundary

Signal intent represents a user's current authoritative desire to participate
in applicable social activity.

Signal intent must support applicable:

- user
- city
- activity
- timing/time window
- crowd eligibility
- age/legal eligibility context
- proximity context
- lifecycle state
- expiration
- journey origin

Expired intent must not remain matchable.

Historical intent must remain distinguishable from active intent.

---

## 9. Signal Pool and Matching Boundary

Signal pools represent compatible populations from which groups may be formed.

The database must not encode one permanent grouping algorithm.

The architecture must support:

- large compatible populations
- multiple groups from one compatible population
- replaceable grouping policy
- deterministic authoritative membership results
- concurrency-safe group formation

A pool of 100 compatible users must not require creation of one 100-person
Signal Group.

---

## 10. Signal Group Boundary

Signal Groups are authoritative social coordination units.

The initial policy supports:

- forming
- confirming
- coordinating
- locked/Plan transition
- active
- completed
- cancelled/expired states as applicable

The architecture must preserve lifecycle truth.

Signal Groups do not require fake human ownership.

---

## 11. Signal Group Membership Boundary

Group membership must be authoritative and concurrency-safe.

Membership must distinguish applicable concepts such as:

- candidate/matched
- confirmed
- active core
- withdrawn
- replaced
- other lifecycle-relevant membership state

The architecture must support:

- target/max group policy
- automatic backfill
- active-core protection
- membership freeze at Plan Lock
- post-lock controlled recovery

Direct client inserts must not bypass membership rules.

---

## 12. Availability Boundary

Availability is structured domain data.

The architecture must support:

- member availability windows
- hard availability constraints
- overlap calculation
- proposed times
- finalized time
- rescheduling history

Time coordination must not rely on parsing chat messages.

---

## 13. Venue Boundary

Venues require stable identity where venue attribution or voting depends on
them.

The architecture must support:

- venue identity
- geographic relationship
- venue category
- eligibility constraints
- organic discovery
- sponsored discovery
- venue candidates
- venue replacement/recovery

A venue recommendation is not the same as authoritative venue selection.

---

## 14. Decision and Voting Boundary

Voting is authoritative domain state.

The architecture must support applicable:

- decision rounds
- eligible voters
- options
- one vote per eligible member per round
- deadlines
- participation thresholds
- primary voting
- runoff
- deterministic tie resolution
- finalization
- immutable finalized result

Voting must be concurrency-safe.

The frontend must not calculate the authoritative winner.

---

## 15. Unified Plan Boundary

SIGNAL has one Plan domain.

Plans may originate from:

- Signal-generated coordination
- Manual creation

The architecture must preserve Plan origin.

Signal-generated Plans may reference their originating Signal Group.

Manual Plans may reference their creator.

Signal-generated Plans do not require fake creator ownership.

---

## 16. Plan Membership and Admission Boundary

Plan membership is authoritative.

The architecture must support applicable admission modes:

- open
- creator approval
- group vote

Mandatory eligibility always overrides admission authority.

Capacity must be concurrency-safe.

The creator of an initial Manual social Plan becomes a participant atomically
with Plan creation.

---

## 17. Plan Change and Recovery Boundary

Material Plan changes require controlled transitions.

The architecture must support historical handling of applicable:

- venue changes
- rescheduling
- member withdrawal
- controlled seat reopening
- recovery
- cancellation
- capacity changes
- material eligibility changes

Historical Plan truth must not be destructively rewritten.

---

## 18. Attendance Boundary

Attendance is distinct from:

- group membership
- Plan membership
- being directed to a venue
- verified spending

The architecture must support future evidence or confidence mechanisms without
requiring fabricated certainty.

---

## 19. Venue Attribution Boundary

SIGNAL must be capable of measuring traffic it facilitates toward venues.

Attribution may preserve dimensions such as:

- Plan origin
- journey origin
- venue-selection origin
- sponsored vs organic source
- directed participant count
- attendance evidence

Attribution must avoid double counting.

---

## 20. Economic Impact Boundary

Economic impact is an estimate unless verified spending evidence exists.

The architecture must distinguish:

- estimated spend
- attendance-based estimated value
- verified spend where future evidence permits
- confidence/source methodology

A $50 average-spend assumption must not be stored or presented as if SIGNAL
verified that every participant spent $50.

---

## 21. Notification Boundary

Notifications communicate authoritative events.

Notifications do not create authoritative domain state.

The architecture must support notification events for applicable:

- match/group formation
- confirmation
- voting
- admission
- venue/time finalization
- Plan Lock
- changes
- recovery
- cancellation
- other important lifecycle events

Reloading the application must recover authoritative truth even if a
notification was missed.

---

## 22. Administration Boundary

Administrative authority must be explicit and narrow.

Admin capabilities may include applicable:

- platform configuration
- taxonomy management
- venue/business management
- sponsorship configuration
- moderation
- analytics
- authorized operational intervention

Admin capability must not be represented as blanket accidental RLS bypass.

Sensitive interventions must be auditable.

---

## 23. Audit and Historical Boundary

SIGNAL requires durable history for commercially and operationally meaningful
transitions.

The architecture does not require universal event sourcing.

It does require sufficient historical records for applicable:

- lifecycle transitions
- membership changes
- voting finalization
- venue changes
- rescheduling
- recovery
- cancellation
- attribution
- administrative intervention

Historical records must not depend solely on frontend analytics events.

---

## 24. Initial Authority Classification

Every future entity/table must be classified as one of:

### Authoritative

Current state whose correctness directly affects product behavior.

### Historical

Durable record of a meaningful transition or prior state.

### Configuration

Platform-controlled policy/taxonomy/configuration.

### Analytical

Derived or measurement-oriented data that must not silently become domain
authority.

### Ephemeral

Replaceable/transient data that may be rebuilt without changing historical
truth.

No G2 table should be introduced without identifying its authority class.

---

## 25. Initial Concurrency Hotspots

The following operations are expected to require explicit concurrency design:

- Signal group formation
- claiming group seats
- confirmation
- backfill/replacement
- Plan creation
- Manual Plan creator membership
- open Plan admission
- creator-approved admission
- group-vote admission
- final available capacity
- voting
- vote finalization
- Plan Lock
- withdrawal after lock
- seat reopening
- venue recovery
- rescheduling
- cancellation
- material Plan edits

These operations must be designed before implementation.

---

## 26. Initial Security Boundary

Client applications must not receive unrestricted mutation authority over
critical domain tables.

G2 must classify future operations into:

- safe direct reads
- safe constrained direct writes
- controlled domain operations
- administrative operations
- service/system operations

RLS and controlled PostgreSQL functions must be designed from those boundaries.

---

## 27. Realtime Boundary

Realtime is a delivery mechanism for committed database truth.

Potential Realtime domains may include:

- Signal group membership
- confirmation
- voting
- coordination
- Plan state
- admission
- recovery
- notifications

Realtime subscriptions must not become the only source of truth.

Reconnect/reload must reconstruct current state from PostgreSQL.

---

## 28. G2 Blueprint Sequence

The database blueprint will be completed in this order:

1. domain/entity inventory
2. relationship map
3. lifecycle/state ownership
4. authority classification
5. invariants and constraints
6. concurrency model
7. controlled operation inventory
8. RLS/access matrix
9. history/audit model
10. indexing/query model
11. Realtime publication model
12. migration dependency order

Only after these are reviewed and locked may migration 0001 be written.

---

## 29. Current G2 Status

G2.0 establishes domain boundaries only.

No physical PostgreSQL table design is locked yet.

No SQL migration is authorized yet.

Next gate:

G2.1 — Domain Entity Inventory.


---

## 30. G2.1 Entity Inventory Principles

An entity is introduced only when it owns meaningful authoritative,
historical, configuration, analytical, or security-relevant state.

Entities must not be created merely because a frontend screen exists.

The initial inventory must distinguish:

- authoritative current state
- historical state
- configuration
- analytical/measurement data
- replaceable/ephemeral data

Physical table design remains deferred until entity relationships and
invariants are reviewed.

---

## 31. Identity and Profile Entities

### User Profile

Authority class: Authoritative

Purpose:

Represents the SIGNAL application identity associated with one authenticated
Supabase Auth user.

Owns applicable application profile state such as:

- authenticated user relationship
- display identity
- profile photo reference
- bio
- private birth date
- home city
- onboarding/completion state
- user-facing profile attributes permitted by product policy

Does not own authentication credentials.

One authenticated user may have at most one authoritative SIGNAL profile.

### Profile Media

Authority class: Authoritative / Historical where applicable

Purpose:

Represents user-owned profile media references where dedicated media tracking
is required.

The initial implementation may keep profile-photo reference directly on the
profile if no independent media lifecycle is needed.

This entity therefore remains candidate/conditional until physical design.

---

## 32. Geography Entities

### State

Authority class: Configuration

Purpose:

Canonical state/region registry.

### City

Authority class: Configuration

Purpose:

Canonical city registry used for:

- onboarding
- home city
- timeline identity
- Signal pooling
- Plan creation
- city entitlement
- venue geography

A city must have stable identity independent of display-name spelling.

### Neighborhood / Area

Authority class: Configuration

Purpose:

Optional finer-grained geographic identity used for matching and venue context.

This entity may be deferred from migration 0001 if V1 proximity can operate
without a canonical neighborhood registry.

---

## 33. Entitlement Entities

### Account Entitlement

Authority class: Authoritative

Purpose:

Represents the user’s current product entitlement state relevant to access.

Must support Free and future Pro/multi-city behavior without relying on
frontend flags.

### City Access Grant

Authority class: Authoritative

Purpose:

Represents explicit access to a city beyond ordinary home-city rules where
needed.

This may be derived from entitlement policy or represented explicitly depending
on G2.2 relationship design.

The schema must not assume that one fixed subscription model will always be
used.

---

## 34. Activity and Discovery Configuration Entities

### Activity Category

Authority class: Configuration

Purpose:

Stable high-level activity grouping.

Examples:

- Food
- Drinks
- Music
- Outdoors
- Games
- Fitness

### Activity

Authority class: Configuration

Purpose:

Stable activity identity used by:

- direct Signal intent
- I'M BORED
- matching
- Plans
- venue compatibility
- analytics

Examples may include:

- Brunch
- Drinks
- Live Music
- Bowling
- Karaoke

### Vibe

Authority class: Configuration

Purpose:

Optional structured discovery/matching dimension.

Examples:

- Chill
- Lively
- Casual
- Upscale

### Discovery Option

Authority class: Configuration

Purpose:

Represents configurable I'M BORED discovery options/prompts where the product
requires server-managed discovery configuration.

The database must not assume one hard-coded permanent card sequence.

---

## 35. I'M BORED Entities

### Discovery Session

Authority class: Historical / Ephemeral

Purpose:

Represents one user journey through I'M BORED.

May own:

- user
- started time
- completed/abandoned state
- resulting journey origin
- resulting Signal intent relationship where applicable

A discovery session is not active social intent by itself.

### Discovery Interaction

Authority class: Historical / Analytical

Purpose:

Represents meaningful user choices during discovery.

Examples:

- selected Drinks
- passed Bowling
- selected Lively
- selected Tonight
- selected Surprise Me

Historical interaction does not equal current Signal participation.

---

## 36. Signal Intent Entity

### Signal Intent

Authority class: Authoritative + Historical lifecycle

Purpose:

Represents one user’s authoritative active social intent.

Owns applicable state such as:

- user
- city
- activity
- structured time window
- crowd mode
- age constraints where user-selected/applicable
- proximity preference/context
- lifecycle state
- expiration
- journey origin
- assignment state

Signal Intent must survive historically after withdrawal, assignment, or
expiration where required for audit and analytics.

Active eligibility must be distinguishable from historical intent.

---

## 37. Signal Pool Concept

### Signal Pool

Authority class: Candidate entity

Purpose:

Represents a compatible population from which groups may be formed.

Important design decision:

A physical Signal Pool entity may or may not be required.

A pool can potentially be derived from compatible active Signal Intents.

However, an explicit entity may be useful if SIGNAL needs:

- stable pool identity
- pool-level configuration
- pool-level lifecycle
- pool analytics
- deterministic grouping work queues

G2.2 must decide whether Signal Pool is:

1. a physical authoritative entity

or

2. a derived compatibility concept.

No table is authorized yet.

---

## 38. Matching Policy Entity

### Grouping Policy

Authority class: Configuration

Purpose:

Defines replaceable grouping policy/configuration.

Initial policy concepts include:

- activation threshold = 4
- target capacity = 6
- maximum automatic capacity = 6

Future policies may vary by:

- activity
- crowd mode
- city
- product version
- other explicit configuration

The matching algorithm itself is not stored as immutable database truth.

Policy identity/configuration may be.

---

## 39. Signal Group Entity

### Signal Group

Authority class: Authoritative + Historical lifecycle

Purpose:

Represents one actual social coordination group produced from compatible Signal
Intent.

Owns:

- group lifecycle
- city
- activity/context
- grouping policy reference/version where applicable
- formation time
- confirmation/coordination state
- Plan relationship once locked
- expiration/cancellation/completion state

A Signal Group may exist without a human creator.

---

## 40. Signal Group Membership Entity

### Signal Group Membership

Authority class: Authoritative + Historical lifecycle

Purpose:

Represents a user’s relationship to one Signal Group.

Owns applicable membership state such as:

- matched
- confirmed
- declined
- timed out
- withdrawn
- replaced
- active core
- membership timestamps
- applicable seat/history state

Must prevent duplicate authoritative membership for the same user/group.

Must support concurrency-safe seat claiming and replacement.

---

## 41. Availability Entities

### Availability Window

Authority class: Authoritative

Purpose:

Represents structured user availability applicable to Signal intent or group
coordination.

Owns:

- start
- end
- hard/soft classification where required
- relationship to intent/group/member as decided in G2.2

### Time Proposal

Authority class: Authoritative / Historical

Purpose:

Represents a candidate shared time produced during coordination where explicit
proposal tracking is required.

### Finalized Schedule

Authority class: Authoritative Plan state

Purpose:

The final scheduled time belongs to the Plan domain.

Whether this requires a dedicated entity or fields plus schedule history will
be decided in G2.2.

---

## 42. Venue Entities

### Venue

Authority class: Configuration / Authoritative platform reference data

Purpose:

Stable venue identity used for:

- discovery
- voting
- Plan destination
- sponsorship
- attribution
- attendance/economic impact

Owns applicable venue metadata and geography.

### Venue Category

Authority class: Configuration

Purpose:

Stable classification such as:

- Bar
- Restaurant
- Lounge
- Coffee Shop
- Bowling
- Live Music Venue

### Venue Candidate

Authority class: Authoritative coordination state

Purpose:

Represents a venue currently eligible for consideration by a Signal Group or
Plan decision.

Preserves source such as:

- organic
- member suggested
- platform suggested
- sponsored

A candidate is not the final selected venue.

---

## 43. Sponsorship Entities

### Business / Venue Partner

Authority class: Authoritative / Configuration

Purpose:

Represents platform-recognized commercial relationship where necessary.

Must not be required merely for a venue to exist.

### Sponsored Campaign

Authority class: Authoritative + Historical

Purpose:

Represents sponsored discovery/promotion configuration and lifecycle.

May support targeting dimensions such as:

- venue
- city
- activity
- date/time
- category

Sponsorship must remain distinguishable from organic recommendation.

---

## 44. Group Decision Entity

### Group Decision

Authority class: Authoritative + Historical

Purpose:

Represents one authoritative decision process.

Decision types may include:

- venue selection
- time selection
- admission
- rescheduling
- recovery venue
- future group decisions

Owns applicable:

- decision type
- group/Plan relationship
- lifecycle
- opening time
- deadline
- participation policy
- finalization state
- winning result

---

## 45. Decision Round Entity

### Decision Round

Authority class: Authoritative + Historical

Purpose:

Represents one voting round within a Group Decision.

Supports:

- primary round
- runoff
- final-call/recovery round where applicable

A decision may therefore have multiple rounds without duplicating the parent
decision itself.

---

## 46. Decision Option Entity

### Decision Option

Authority class: Authoritative

Purpose:

Represents an eligible choice within a decision round.

Examples:

- Venue A
- Venue B
- 8:30 PM
- 9:00 PM
- applicant X where admission uses generic decision architecture

Option design must not force every decision type into inappropriate fields.

G2.2 must determine whether generic options or typed decision-specific entities
provide the cleanest authoritative model.

---

## 47. Vote Entity

### Vote

Authority class: Authoritative + Historical

Purpose:

Represents one eligible member's current/final vote in a decision round.

Must support:

- one vote per eligible voter per round
- controlled change before deadline where policy permits
- immutable finalized historical outcome
- concurrency-safe uniqueness

A vote is not the same as a decision result.

---

## 48. Unified Plan Entity

### Plan

Authority class: Authoritative + Historical lifecycle

Purpose:

Represents a concrete real-world outing.

Owns applicable:

- origin: manual or signal
- creator relationship where manual
- originating Signal Group where signal
- city
- activity
- current lifecycle state
- capacity
- crowd eligibility
- age/legal eligibility
- admission mode
- scheduled time/current destination
- publication/discovery state
- lock state
- completion/cancellation state

Signal-origin Plans do not require fake creator ownership.

---

## 49. Plan Membership Entity

### Plan Membership

Authority class: Authoritative + Historical

Purpose:

Represents a user's authoritative relationship to a Plan.

Owns applicable:

- membership state
- origin of admission
- locked membership status
- join/admission timestamps
- withdrawal state
- attendance relationship where applicable

Must prevent duplicate authoritative membership and capacity overflow.

---

## 50. Admission Request Entity

### Admission Request

Authority class: Authoritative + Historical

Purpose:

Represents a non-member's request to enter a Plan where admission mode requires
a request.

Owns:

- applicant
- Plan
- lifecycle
- submission time
- final outcome
- applicable decision/approval relationship

Must prevent contradictory duplicate active requests.

---

## 51. Plan Change / Recovery Entity

### Plan Change Request

Authority class: Authoritative + Historical

Purpose:

Generic concept for material Plan changes where request/approval history is
required.

Potential change types:

- reschedule
- venue replacement
- capacity change
- cancellation proposal
- other controlled material change

G2.2 must determine whether a single generic entity or dedicated typed entities
produce clearer invariants.

---

## 52. Plan History Entity

### Plan Event / Plan History

Authority class: Historical

Purpose:

Preserves meaningful Plan transitions that must not be destructively
overwritten.

Examples:

- locked
- member withdrew
- venue changed
- time changed
- recovery started
- recovery finalized
- cancelled
- active outing
- completed

This does not require full event sourcing.

Current Plan state remains authoritative separately.

---

## 53. Attendance Entity

### Attendance Record

Authority class: Authoritative / Analytical depending evidence level

Purpose:

Represents attendance evidence associated with a user, Plan, and venue where
appropriate.

Must distinguish evidence/confidence from absolute certainty.

Potential states may include:

- unknown
- self-confirmed
- location-supported
- partner-verified
- future verified method

Attendance must not be inferred merely from Plan membership.

---

## 54. Venue Attribution Entity

### Venue Attribution Event

Authority class: Historical / Analytical

Purpose:

Records meaningful stages in SIGNAL's venue-impact funnel.

Potential event types:

- impression
- view
- vote
- selected
- Plan locked
- directions opened
- directed
- redirected
- attendance evidence
- other future attribution stage

Must preserve:

- venue
- Plan/group context
- source/origin
- campaign where applicable
- timestamp
- applicable count/user context under privacy policy

Historical attribution must survive venue recovery.

---

## 55. Economic Impact Entities

### Spend Benchmark

Authority class: Configuration / Analytical

Purpose:

Stores estimated average-spend methodology inputs.

May vary by:

- venue
- category
- city
- time period
- methodology/source

### Economic Impact Record

Authority class: Analytical / Historical

Purpose:

Represents calculated economic-impact estimates or verified spend evidence.

Must distinguish:

- estimated
- attendance-adjusted estimate
- verified
- methodology/provenance

Must avoid double counting across redirected venues.

---

## 56. Notification Entity

### Notification

Authority class: Authoritative delivery state / Historical

Purpose:

Represents a user-facing notification generated from authoritative domain
events.

Notification state may include:

- recipient
- type
- related domain object
- created time
- read state
- delivery metadata where applicable

Notification is not the source of the domain event.

---

## 57. Administration Entities

### Platform Role / Admin Grant

Authority class: Authoritative security state

Purpose:

Represents explicit privileged capability.

Must not rely on a user-editable profile field.

### Administrative Action

Authority class: Historical / Audit

Purpose:

Records sensitive operational or administrative interventions.

Should preserve:

- actor
- action
- target
- reason/context where required
- timestamp
- result

---

## 58. Core Candidate Entity Inventory

The current G2.1 candidate inventory is:

1. user_profile
2. state
3. city
4. neighborhood_area — optional/defer candidate
5. account_entitlement
6. city_access_grant — relationship design pending
7. activity_category
8. activity
9. vibe
10. discovery_option
11. discovery_session
12. discovery_interaction
13. signal_intent
14. signal_pool — physical-vs-derived decision pending
15. grouping_policy
16. signal_group
17. signal_group_membership
18. availability_window
19. time_proposal — physical design pending
20. venue
21. venue_category
22. venue_candidate
23. business_partner
24. sponsored_campaign
25. group_decision
26. decision_round
27. decision_option
28. vote
29. plan
30. plan_membership
31. admission_request
32. plan_change_request — generic-vs-typed decision pending
33. plan_history
34. attendance_record
35. venue_attribution_event
36. spend_benchmark
37. economic_impact_record
38. notification
39. platform_role/admin_grant
40. administrative_action

This is an entity inventory, not a table list.

Several candidate entities may be:

- merged
- derived
- deferred
- represented through relationships
- represented through history rather than current-state tables

during G2.2.

---

## 59. Entities That Must Not Be Faked

The schema must not introduce fake concepts solely for convenience.

Examples:

- fake creator for Signal-origin Plan
- fake owner for Signal Group
- fake attendance from membership
- fake verified spend from estimates
- fake venue selection from recommendation
- fake active intent from historical I'M BORED taps
- fake city access from hidden navigation

These distinctions are mandatory.

---

## 60. G2.1 Status

G2.1 identifies candidate domain entities.

No physical table layout is locked yet.

No foreign-key layout is locked yet.

No SQL is authorized yet.

Next gate:

G2.2 — Relationship + Authority Map.


---

## 61. G2.2 Relationship Design Principles

Relationships must represent domain truth rather than frontend convenience.

The architecture distinguishes:

- authentication identity
- application identity
- active/current authoritative state
- lifecycle relationships
- historical relationships
- analytical relationships

Foreign relationships must not manufacture ownership that the product does not
actually have.

---

## 62. Authentication to Profile Relationship

Conceptually:

Supabase Auth User
→ 0..1 SIGNAL User Profile

Each authoritative SIGNAL profile belongs to exactly one authenticated user.

An authenticated account may temporarily have no completed profile during
onboarding.

The application must not create multiple active profiles for one Auth identity.

Authentication credentials remain outside the application profile domain.

---

## 63. Profile to Home City Relationship

Conceptually:

User Profile
→ exactly one Home City after onboarding completion

Home City
→ exactly one State

A completed user profile requires authoritative home-city identity.

The user's home city is not represented as arbitrary free-form text.

Changing home city is an entitlement-sensitive domain operation rather than a
cosmetic profile edit.

---

## 64. City Entitlement Relationship

Home-city access and additional-city access are distinct concepts.

Conceptually:

User
→ Home City

and, where policy permits:

User
→ Account Entitlement
→ Additional City Access

For initial Free behavior, home-city access may be derived directly from the
profile relationship.

Explicit city-access records are needed only for access beyond normal home-city
rights or where future entitlement policy requires them.

Therefore:

city_access_grant remains a physical candidate for paid/exceptional access,
not a mandatory duplicate row for every user's home city.

---

## 65. Activity Taxonomy Relationship

Conceptually:

Activity Category
→ many Activities

Activity
↔ applicable Venue Categories

Activity
↔ applicable Vibes where configured

Discovery configuration may reference Activities, Categories, Vibes, or other
supported discovery dimensions.

Signal Intent references stable Activity identity rather than storing only a
presentation label.

---

## 66. Discovery Relationship

Conceptually:

User
→ many Discovery Sessions

Discovery Session
→ many Discovery Interactions

Discovery Session
→ 0..1 resulting Signal Intent

A Discovery Interaction may reference applicable configuration such as:

- Activity
- Activity Category
- Vibe
- Discovery Option

Discovery interactions remain historical/analytical.

They do not independently place the user into a Signal Group.

---

## 67. Signal Intent Ownership

Conceptually:

User
→ many historical Signal Intents

A Signal Intent belongs to exactly one user.

A Signal Intent references exactly one applicable city.

It may reference:

- Activity
- availability/time window
- crowd preference
- proximity context
- journey origin
- other structured compatibility dimensions

Signal Intent owns the authoritative lifecycle of that specific expression of
social intent.

The User Profile does not own current Signal matching state.

---

## 68. Active Signal Intent Rule

Historical Signal Intents may coexist.

Matchable active intent must be constrained by explicit lifecycle policy.

The physical schema must support prevention of contradictory duplicate active
intent where the product policy defines such combinations as invalid.

This constraint must not be left solely to frontend button state.

Exact uniqueness scope will be finalized during G2.3 invariants.

---

## 69. Signal Pool Resolution

For V1, Signal Pool is a DERIVED DOMAIN CONCEPT.

No authoritative signal_pool table is required for migration 0001.

A compatible population is derived from authoritative active Signal Intents
using the current matching/grouping policy.

When an actual group is formed, Signal Group becomes authoritative.

Reasons:

- avoids duplicating compatibility state
- avoids stale pool membership
- keeps matching policy replaceable
- supports dynamic population changes
- prevents a derived candidate population from becoming accidental truth

Future scale may justify:

- materialized compatibility buckets
- queue tables
- partitioned matching work
- cached pool projections

Those optimizations must remain rebuildable from authoritative intent and must
not redefine product truth.

---

## 70. Grouping Policy Relationship

Conceptually:

Grouping Policy
→ used by many Signal Groups

A Signal Group may preserve the policy/version under which it formed.

This permits future grouping policy changes without rewriting historical group
meaning.

The algorithm implementation itself remains replaceable.

---

## 71. Signal Group Relationship

Conceptually:

City
→ many Signal Groups

Activity
→ many Signal Groups

Grouping Policy
→ many Signal Groups

Signal Group
→ many Signal Group Memberships

Signal Group
→ zero or one resulting Plan

Signal Group has no required human owner.

---

## 72. Intent to Group Membership Relationship

Signal Intent and Signal Group Membership are distinct.

Conceptually:

Signal Intent
→ may result in a Signal Group Membership

Signal Group Membership
→ belongs to one User
→ belongs to one Signal Group
→ may reference originating Signal Intent

Preserving the originating intent relationship allows SIGNAL to understand why
the user entered the group without making the historical intent itself the
membership record.

---

## 73. Signal Group Membership Authority

Signal Group Membership owns authoritative group participation state.

It must not be inferred solely from:

- an active Signal Intent
- a Discovery Session
- a frontend group card
- a notification

The relationship:

User + Signal Group

must have controlled uniqueness.

Historical withdrawn/replaced membership remains preserved.

G2.3 will define the exact uniqueness model for active versus historical
membership.

---

## 74. Availability Relationship

Availability is attached to the intent/coordination context that gave it
meaning.

Conceptually:

Signal Intent
→ one or more Availability Windows

During group coordination, applicable member availability can be evaluated from
the originating/current coordination state.

If availability becomes independently editable after group formation, the
architecture may preserve group-context availability separately rather than
silently rewriting the original intent.

Final Plan schedule is separate authoritative Plan state.

---

## 75. Venue Relationship

Conceptually:

State
→ many Cities

City
→ many Venues

Venue Category
→ many Venues

Venue
→ many Venue Candidates

Venue
→ many Plans over time

Venue
→ many Attribution Events

Venue
→ many Spend Benchmarks over time

A venue does not require an active commercial partnership to exist.

---

## 76. Business Partner Relationship

Commercial partnership is separate from venue identity.

Conceptually:

Business Partner
→ may control/manage one or more Venues

Venue
→ may have zero or more historical/active commercial relationships

Sponsored Campaign
→ belongs to an authorized Business Partner/platform relationship
→ targets applicable Venue(s)/city/activity/category context

A venue becoming sponsored must not create a second venue identity.

---

## 77. Venue Candidate Relationship

Venue Candidate belongs to a specific coordination context.

Conceptually:

Signal Group or applicable Plan recovery context
→ many Venue Candidates

Venue Candidate
→ exactly one Venue

Venue Candidate preserves candidate source.

Candidate status does not make the venue authoritative Plan destination.

Final venue selection occurs through the applicable decision/finalization
operation.

---

## 78. Decision Relationship

Conceptually:

Signal Group or Plan
→ many Group Decisions over lifecycle

Group Decision
→ one or more Decision Rounds

Decision Round
→ many Decision Options

Decision Round
→ many Votes

Group Decision
→ one finalized result

A Decision owns the overall decision lifecycle.

A Round owns one voting attempt.

A Vote owns one eligible participant's selection in one round.

---

## 79. Typed Decision Context

The generic decision architecture may support multiple decision types, but
domain meaning must remain explicit.

Examples:

venue_selection
time_selection
plan_admission
venue_recovery
reschedule

Decision options may require typed references.

For example:

a venue-selection option should reference a Venue Candidate rather than store
only "Bar A" text.

A time-selection option should preserve structured timestamp/range data rather
than only "9 PM" text.

G2 physical design may use typed nullable references plus validation or
decision-specific supporting entities.

It must not depend on uninterpreted JSON as the sole source of critical
decision truth.

---

## 80. Voting Eligibility Relationship

Vote eligibility derives from authoritative membership/governance state.

A Vote belongs to:

- one Decision Round
- one eligible User
- one Decision Option

The database must ensure that the selected option belongs to the same round.

The database/domain operation must ensure that the voter was eligible for that
decision.

Finalized voting history must remain durable.

---

## 81. Signal Group to Plan Relationship

A Signal Group may produce at most one authoritative resulting Plan under the
initial model.

Conceptually:

Signal Group
→ 0..1 Signal-origin Plan

Plan
→ 0..1 originating Signal Group

For Signal-origin Plans, originating group identity is required.

For Manual Plans, originating Signal Group is absent.

No fake group is created for Manual Plans.

---

## 82. Manual Plan Creator Relationship

Conceptually:

User
→ many Manual Plans created

Manual Plan
→ exactly one creator

Signal-origin Plan
→ no required creator

The Plan origin determines which origin relationship is valid.

The physical schema must prevent contradictory combinations such as:

origin = manual with no creator

or:

origin = signal with no originating Signal Group.

Exact enforcement belongs to G2.3.

---

## 83. Plan Membership Separation

Signal Group Membership and Plan Membership are separate authoritative
relationships.

They must not be collapsed into one table.

Reason:

Signal Group membership answers:

"Who participated in this matching/coordination group and what happened to that
membership?"

Plan membership answers:

"Who became an authoritative participant in this actual outing?"

At Plan Lock, applicable Signal Group members are copied/transitioned through a
controlled operation into Plan Membership.

The original Signal Group Membership remains historical truth.

---

## 84. Manual Plan Creation Relationship

Manual Plan creation is atomic at the domain-operation level.

Conceptually:

Creator
→ creates Manual Plan
→ creator Plan Membership established

These must succeed together.

The frontend must not:

1. insert Plan
2. later attempt unrelated membership insert

and leave a creatorless/participantless partial Plan if step two fails.

---

## 85. Plan Admission Relationship

Conceptually:

Plan
→ many historical Admission Requests

Admission Request
→ one Applicant

Admission Request
→ may resolve through:

- automatic open-admission operation
- creator approval
- Group Decision

Successful admission:

Admission Request
→ resulting Plan Membership

The admission request itself remains historical.

A rejected or expired request does not create membership.

---

## 86. Plan Capacity Ownership

Capacity belongs to Plan authoritative state/policy.

Current occupancy derives from authoritative Plan Membership.

The Plan must not store a manually maintained "current_member_count" as primary
truth if that value can drift from membership records.

Cached/derived counts may exist later for performance but must remain
rebuildable.

Capacity admission must use authoritative membership under concurrency.

---

## 87. Plan Venue Relationship

Plan owns the current authoritative destination once selected.

Conceptually:

Plan
→ 0..1 current Venue

Historical venue changes must be preserved separately.

A current venue foreign relationship must not erase:

- prior selected venue
- redirection
- venue attribution already generated
- recovery history

---

## 88. Plan Schedule Relationship

Plan owns its current authoritative scheduled time/window.

Historical reschedules must be preserved separately.

Current schedule may be represented on Plan or through a dedicated current
schedule relationship depending on physical design.

Historical schedule changes must not be reconstructed solely from current
fields.

---

## 89. Material Plan Change Design

G2.1 proposed a generic Plan Change Request.

G2.2 resolves this as follows:

Do NOT begin migration 0001 with one universal polymorphic
plan_change_request table.

Instead:

- current Plan state remains authoritative
- Group Decision handles changes requiring collective decision
- Plan History records finalized meaningful transitions
- specialized supporting entities are introduced only where a lifecycle
  requires state that cannot be represented safely by Decision + History

This avoids an early "god table" containing unrelated change semantics.

---

## 90. Plan History Relationship

Conceptually:

Plan
→ many Plan History records

Each record preserves a meaningful finalized transition.

Plan History is historical.

It does not replace Plan current state.

Applicable history may preserve:

- event type
- actor/system source
- previous meaningful value
- resulting meaningful value
- related Decision
- timestamp
- reason/context

Physical representation must avoid relying on opaque free-form text for
critical reconstructable transitions.

---

## 91. Cancellation Relationship

Cancellation is current Plan lifecycle state plus historical transition.

The authoritative Plan becomes cancelled.

Plan History preserves the cancellation event.

Applicable Decision/Admin Action may preserve how cancellation was authorized.

Deletion is not cancellation.

---

## 92. Attendance Relationship

Conceptually:

Plan Membership
→ 0..n Attendance Evidence/Records

Attendance Record
→ Plan
→ User
→ applicable Venue

Attendance must reference the Plan context.

Attendance state must not be inferred simply because Plan Membership exists.

Multiple evidence records may eventually contribute to one attendance
assessment.

G2.3/G2.4 will determine whether V1 stores one assessment row or separate
evidence + assessment structures.

---

## 93. Attribution Relationship

Conceptually:

Venue Attribution Event
→ Venue
→ applicable Plan and/or Signal Group
→ applicable User or aggregate subject where privacy policy permits
→ journey origin
→ selection origin
→ Sponsored Campaign where applicable

Attribution events are historical measurement records.

They must not mutate Plan membership or attendance truth.

---

## 94. Economic Impact Relationship

Conceptually:

Spend Benchmark
→ Venue and/or Venue Category + geographic/time context

Economic Impact Record
→ Venue
→ Plan
→ methodology/source
→ applicable Attendance/Attribution basis

Economic impact is derived from authoritative/historical inputs.

It does not become evidence that the spending actually occurred unless its
verification classification explicitly says so.

---

## 95. Notification Relationship

Conceptually:

User
→ many Notifications

Notification
→ may reference applicable domain object/event

Notification read/delivery state belongs to Notification.

The underlying Plan/Group/Decision state does not belong to Notification.

Deleting or missing a notification must not alter domain truth.

---

## 96. Administrative Authority Relationship

Administrative capability is separate from ordinary profile state.

Conceptually:

Auth User / User Profile
→ explicit Admin Grant / Platform Role

Administrative Action
→ Admin Actor
→ target domain object
→ action type
→ timestamp/result

A user must not obtain administrative authority by editing their own profile.

---

## 97. Current-State vs Historical-State Rule

SIGNAL uses authoritative current state plus targeted durable history.

It does not require full event sourcing for V1.

Examples:

Signal Intent:
current lifecycle fields + durable historical row after terminal state.

Signal Group:
current lifecycle state + preserved memberships/decisions.

Plan:
current authoritative state + Plan History.

Voting:
current open decision state + durable finalized rounds/votes/result.

Venue attribution:
historical event records.

Administrative intervention:
historical audit records.

The current-state row must remain sufficient to load the application without
replaying the entire historical event stream.

---

## 98. No Polymorphic Foreign-Key Escape Hatch

Critical domain relationships should use enforceable references.

The initial schema should avoid making critical authority depend on patterns
such as:

object_type = 'anything'
object_id = arbitrary UUID

where PostgreSQL cannot enforce the referenced object.

Generic references may be acceptable for low-risk presentation metadata.

They must not become the foundation for:

- membership
- Plan ownership
- voting authority
- venue selection
- admission
- attendance
- security

---

## 99. Deletion Doctrine

Authoritative/historical social records should generally transition state
rather than be destructively deleted.

Examples include:

- Signal Intent
- Signal Group Membership
- Plan
- Plan Membership
- Admission Request
- Decision
- Vote
- Attendance
- Attribution
- Admin Action

Hard deletion may remain appropriate for:

- invalid setup data
- certain configuration cleanup before use
- legally required privacy deletion/anonymization workflows
- other explicit administrative maintenance

Deletion policy must not destroy commercially meaningful historical truth
accidentally.

---

## 100. G2.2 Resolved Candidate Decisions

G2.2 resolves the following G2.1 questions:

### Signal Pool

V1: derived concept.

No authoritative signal_pool table in migration 0001.

### City Access Grant

Physical entity only where explicit additional/exceptional city access is
required.

Home-city access derives from authoritative profile home city.

### Profile Media

No dedicated profile_media entity required for migration 0001 unless storage
lifecycle requirements discovered in G2.3/G2.4 require it.

Profile stores the authoritative current avatar/storage reference.

### Time Proposal

Time proposals may use the Group Decision architecture.

No independent generic time_proposal entity is required solely because time
voting exists.

### Plan Change Request

No universal plan_change_request table in migration 0001.

Use current Plan state + Group Decision + Plan History + specialized entities
only where proven necessary.

### Signal Membership vs Plan Membership

Remain separate.

### Current State vs History

Use current authoritative rows plus targeted durable history.

No full event-sourcing requirement for V1.

---

## 101. Core Relationship Map

Conceptually:

Supabase Auth
→ User Profile
→ Home City
→ Account Entitlement / Additional City Access

User Profile
→ Discovery Session
→ Discovery Interaction
→ Signal Intent

Signal Intent
→ derived compatibility population
→ Signal Group
→ Signal Group Membership

Signal Group
→ Group Decision
→ Decision Round
→ Decision Option
→ Vote

Signal Group
→ Venue Candidate
→ Venue

Signal Group
→ Signal-origin Plan

User Profile
→ Manual Plan

Plan
→ Plan Membership
→ Admission Request

Plan
→ Group Decision
→ Plan History

Plan
→ Current Venue
→ Venue Attribution Event

Plan Membership
→ Attendance Record

Venue / Venue Category
→ Spend Benchmark

Plan + Attendance/Attribution
→ Economic Impact Record

Business Partner
→ Sponsored Campaign
→ Venue/Discovery exposure

Admin Grant
→ Administrative Action

Notification
← authoritative events throughout the domain

---

## 102. G2.2 Authority Map

### Authentication authority

Supabase Auth

### Application identity authority

User Profile

### Geographic authority

State + City configuration

### City access authority

Home-city relationship + explicit entitlement/access policy

### Discovery history authority

Discovery Session + Discovery Interaction

### Current social-intent authority

Signal Intent

### Compatibility population

Derived from authoritative active Signal Intent

### Group authority

Signal Group

### Group participation authority

Signal Group Membership

### Availability authority

Structured Availability Window / applicable coordination state

### Decision authority

Group Decision + Decision Round + Decision Option + Vote

### Venue identity authority

Venue

### Current Plan authority

Plan

### Plan participation authority

Plan Membership

### Admission authority

Controlled admission operation + Admission Request/Decision where applicable

### Historical Plan transition authority

Plan History

### Attendance authority

Attendance Record/evidence model

### Venue-impact measurement

Venue Attribution Event

### Economic-impact estimate

Economic Impact Record + Spend Benchmark methodology

### Administrative authority

Admin Grant / Platform Role

### Administrative audit authority

Administrative Action

### Notification delivery state

Notification

---

## 103. G2.2 Status

The core entity relationships and authority boundaries are now defined.

The following are explicitly resolved:

- Signal Pool is derived for V1
- Signal Group has no fake owner
- Signal-origin Plan has no fake creator
- Manual Plan creator is explicit
- Signal Group Membership and Plan Membership are separate
- Plan occupancy derives from Plan Membership
- current Plan state and Plan History are separate
- time voting uses the Decision domain
- generic Plan Change Request is not required for migration 0001
- critical relationships must remain database-enforceable
- current state can be loaded without replaying full history

No SQL is authorized yet.

Next gate:

G2.3 — Invariants + Concurrency Model.


---

## 104. G2.3 Invariant Doctrine

An invariant is a rule that must remain true regardless of:

- frontend behavior
- browser refresh
- Realtime delivery order
- direct API attempts
- network retries
- two users acting simultaneously
- duplicate client submissions

Critical invariants belong to PostgreSQL/database-controlled domain operations.

The frontend may anticipate an invariant.

It does not own the invariant.

---

## 105. Identity Invariants

The identity model must enforce:

1. One authenticated Supabase Auth identity may have at most one authoritative
   SIGNAL profile.

2. A completed profile must reference a valid canonical home city.

3. Profile photo requirement must be enforced by onboarding/domain completion
   rules before the profile is considered complete.

4. Raw birth date remains private data.

5. Public age representation must be derived from authoritative birth date or
   applicable age-verification state rather than arbitrary client age input.

6. Administrative privilege must not derive from a user-editable profile field.

---

## 106. Geography Invariants

The geography model must enforce:

1. Every city belongs to a valid state/region.

2. Core city relationships use canonical city identity.

3. A Signal Intent cannot reference a nonexistent or invalid city.

4. A Plan cannot reference a nonexistent or invalid city.

5. A venue must reference valid applicable geography.

6. Free city access cannot be bypassed by submitting another city identifier
   directly.

7. Additional city access requires valid entitlement/explicit access authority.

---

## 107. Signal Intent Invariants

The Signal Intent domain must enforce:

1. Every Signal Intent belongs to exactly one user.

2. Every Signal Intent references one valid city.

3. Every matchable Signal Intent references valid structured activity/context.

4. Every active Signal Intent has authoritative timing/expiration where the
   Signal is time-sensitive.

5. Expired intent cannot remain matchable.

6. Withdrawn intent cannot remain matchable.

7. Assigned historical intent cannot silently become a second active duplicate
   unless explicit product policy creates a new intent.

8. I'M BORED history does not automatically equal active Signal Intent.

9. Mandatory eligibility context cannot be bypassed by client mutation.

---

## 108. Active Intent Uniqueness

The physical schema must prevent contradictory duplicate active intent.

The initial rule should not necessarily prohibit a user from expressing more
than one unrelated activity interest.

It should prohibit duplicate authoritative active intent representing the same
effective matching context where duplicate participation would create
contradictory matching behavior.

The exact uniqueness key may consider applicable dimensions such as:

- user
- city
- activity
- relevant time bucket/window
- crowd mode
- lifecycle state

This may require a partial uniqueness mechanism or controlled intent operation.

The design must not rely on disabling a button after one click.

---

## 109. Signal Group Invariants

The Signal Group domain must enforce:

1. Every Signal Group references valid grouping context.

2. A Signal Group may exist without a human owner.

3. A Signal Group preserves the grouping policy/version under which it formed
   where required.

4. Automatic membership cannot exceed applicable grouping-policy capacity.

5. Initial automatic capacity is six under the initial policy.

6. Coordination cannot begin under the initial policy without at least four
   confirmed eligible members.

7. A terminal completed/cancelled/expired group cannot silently return to an
   active lifecycle state.

8. One Signal Group may produce at most one authoritative Plan under the initial
   model.

---

## 110. Signal Group Membership Invariants

The membership model must enforce:

1. One user cannot occupy duplicate authoritative membership in the same Signal
   Group.

2. Seat capacity cannot be exceeded.

3. Matched and confirmed are distinct participation states.

4. A timed-out/declined/withdrawn membership cannot be counted as confirmed
   capacity.

5. Active-core membership must correspond to valid confirmed participation.

6. Automatic backfill must respect capacity.

7. Automatic backfill must respect eligibility.

8. Automatic membership stops at Plan Lock.

9. Replaced membership history must remain preserved.

10. A user must not receive two simultaneous authoritative seats in the same
    group due to concurrent matching.

---

## 111. Group Formation Concurrency

Group formation is a concurrency hotspot.

Example:

Five eligible users become available at nearly the same time while two workers
attempt to form a group.

The system must not produce:

- duplicate groups containing the same user
- the same intent assigned to multiple active groups
- more members than capacity
- partially formed contradictory groups

Group formation must therefore use one controlled concurrency boundary.

Possible implementation mechanisms may include:

- transaction locking
- row locking
- advisory locking
- claim/update semantics
- another PostgreSQL-safe mechanism

G2.3 defines the requirement, not the implementation choice.

---

## 112. Seat Claiming Concurrency

Seat claiming must be atomic.

Example:

A group has one automatic seat remaining.

Two compatible users are simultaneously selected for that seat.

Only one may become authoritative member #6.

The other must remain eligible for another matching outcome.

Checking:

"count < 6"

and then performing an unrelated later insert is insufficient.

Capacity validation and membership establishment must occur inside the same
controlled concurrency boundary.

---

## 113. Confirmation Invariants

Confirmation must enforce:

1. Only an applicable matched member may confirm.

2. Confirmation cannot occur after the membership is no longer actionable.

3. Duplicate confirmation retries must be idempotent or harmless.

4. A confirmation deadline is backend-authoritative.

5. A timed-out seat cannot simultaneously be both replaced and later confirmed.

6. Confirmation must not independently overfill a group.

---

## 114. Replacement and Backfill Concurrency

Replacement/backfill must enforce:

1. One vacant/recoverable seat cannot be awarded to two users.

2. A member must not be replaced after valid confirmation already finalized
   unless explicit policy permits another transition.

3. Eligibility must be reevaluated at the time of authoritative backfill.

4. Backfill must stop after Plan Lock.

5. A late backfill action must not mutate a locked/completed/cancelled group.

6. Historical replaced membership remains preserved.

---

## 115. Availability Invariants

Availability must enforce:

1. End time is later than start time.

2. Hard availability cannot be treated as soft by authoritative scheduling
   operations.

3. Expired availability cannot remain usable indefinitely.

4. Availability used for group coordination must belong to the relevant
   user/context.

5. A finalized Plan time must satisfy applicable hard constraints required by
   Plan Lock policy.

---

## 116. Venue Invariants

Venue data must enforce:

1. Venue identity is stable.

2. Sponsorship does not create duplicate venue identity.

3. A Venue Candidate references exactly one real Venue.

4. Candidate source remains explicit.

5. Venue Candidate does not equal Plan destination.

6. Selected/current Plan venue must result from an authorized Plan/manual
   creation or decision/recovery operation.

7. Historical prior venues remain preserved when destination changes.

---

## 117. Decision Invariants

The Decision domain must enforce:

1. Every Decision belongs to one valid decision context.

2. Every Decision Round belongs to one Decision.

3. Every Decision Option belongs to one Decision Round.

4. Every Vote belongs to one Decision Round.

5. Every Vote references an option belonging to that same round.

6. One eligible user has at most one authoritative current vote per round.

7. An ineligible user cannot create a valid vote.

8. A finalized round cannot accept outcome-changing votes.

9. One round cannot have multiple contradictory authoritative winners.

10. A finalized Decision has one authoritative outcome.

11. Realtime ordering cannot determine the winner.

---

## 118. Vote Write Concurrency

Vote writes must tolerate:

- user double-click
- network retry
- simultaneous vote change
- duplicate request
- round closing while vote is being submitted

The system must guarantee one authoritative vote per user per round.

If vote changes are permitted before deadline, update semantics must preserve
that uniqueness.

A vote racing with finalization must resolve according to authoritative
database time/state.

---

## 119. Vote Finalization Concurrency

Vote finalization is a critical serialization point.

If two clients/workers attempt to finalize the same round simultaneously:

- only one authoritative finalization may occur
- both must observe the same final result
- multiple winners must not be created
- late votes must not alter the finalized result

Finalization must atomically establish:

- round closed state
- applicable result
- Decision progression
- runoff creation where required

or otherwise fail consistently.

---

## 120. Runoff Invariants

Runoff behavior must enforce:

1. At most one runoff under the initial venue-voting policy.

2. Runoff choices come only from applicable tied primary choices.

3. Primary votes are not automatically copied as runoff votes.

4. Runoff has independent authoritative timing.

5. A second unresolved tie uses deterministic SIGNAL resolution.

6. Sponsored status cannot secretly resolve the tie.

---

## 121. Plan Origin Invariants

The unified Plan domain must enforce:

1. Every Plan has exactly one valid origin.

2. Manual origin requires an authoritative creator.

3. Signal origin requires an authoritative originating Signal Group.

4. Signal origin does not require a fake creator.

5. Manual origin does not require a fake Signal Group.

6. Contradictory origin combinations are invalid.

---

## 122. Manual Plan Creation Concurrency

Manual Plan creation must atomically establish applicable:

- Plan
- creator relationship
- creator Plan Membership
- initial eligibility configuration
- initial capacity
- initial schedule/venue where provided
- initial lifecycle/publication state

A partial Plan must not become publicly actionable if creator membership
creation fails.

Repeated submission must not create unintended duplicate Plans when the same
creation operation is retried.

---

## 123. Plan Membership Invariants

Plan Membership must enforce:

1. One user cannot have duplicate authoritative membership in one Plan.

2. Membership cannot exceed authoritative Plan capacity.

3. Creator membership cannot duplicate.

4. Signal-origin locked membership must derive from applicable confirmed Signal
   Group participation.

5. Withdrawn members are not counted as current occupancy.

6. Historical membership remains preserved.

7. Direct client insertion cannot bypass admission policy.

8. Post-lock additions use controlled admission.

---

## 124. Plan Capacity Concurrency

Capacity admission is a critical race.

Example:

Plan capacity = 6.

Current membership = 5.

Two eligible users attempt open admission simultaneously.

Exactly one may receive the final seat.

The system must not implement this as:

read count = 5
→ both clients see space
→ both insert
→ occupancy = 7

Capacity validation and membership creation must occur within one controlled
database operation/transaction.

---

## 125. Admission Request Invariants

Admission Requests must enforce:

1. Applicant is not already an active Plan member.

2. Duplicate active requests for the same applicant/Plan are prohibited where
   policy requires.

3. Applicant eligibility is checked at request time where appropriate.

4. Eligibility is checked again at final admission.

5. Rejected/expired requests cannot create membership.

6. Successful admission creates at most one Plan Membership.

7. Capacity is revalidated at finalization.

---

## 126. Creator Approval Concurrency

Creator approval must tolerate:

- two approval attempts
- approval racing with applicant withdrawal
- approval racing with final-seat admission
- approval racing with Plan cancellation
- eligibility changing between request and approval

The authoritative operation must revalidate current Plan state, eligibility,
request state, and capacity before membership creation.

---

## 127. Group-Vote Admission Concurrency

Admission-by-vote must separate:

- vote result
- actual membership insertion

A successful vote does not guarantee insertion if capacity or eligibility has
changed before finalization.

The final admission operation must atomically verify:

- request still actionable
- vote/Decision finalized in favor
- applicant still eligible
- capacity available
- applicant not already member

and then create membership exactly once.

---

## 128. Plan Lock Invariants

Plan Lock must enforce at least:

1. Plan/Signal Group is in valid pre-lock state.

2. At least four confirmed eligible members exist for initial Signal-origin
   flow.

3. Required venue is finalized where applicable.

4. Required scheduled time is finalized.

5. Mandatory eligibility remains valid.

6. Signal-origin Plan relationship is valid.

7. Applicable Plan memberships are established consistently.

8. Automatic Signal membership freezes.

9. Lock occurs exactly once.

10. Concurrent lock attempts cannot create multiple Plans or contradictory
    locked state.

---

## 129. Plan Lock Concurrency

Plan Lock is one of SIGNAL's most critical atomic operations.

A Signal Group must not produce:

- two Plans
- two different locked venues
- two different locked times
- inconsistent group and Plan membership
- continued automatic group filling after successful lock

The operation must serialize the transition from coordinating group to locked
Plan.

The exact PostgreSQL mechanism will be selected during migration design.

---

## 130. Material Edit Invariants

Material Plan edits must enforce:

1. Capacity cannot be reduced below current authoritative occupancy.

2. Eligibility changes cannot silently retain newly ineligible members.

3. Venue changes after commitment use controlled workflow.

4. Time changes after commitment use rescheduling.

5. City changes cannot bypass entitlement.

6. Admission-mode changes cannot corrupt active requests/decisions.

7. Completed/cancelled Plans cannot receive ordinary material edits.

8. Current state and historical transition are updated consistently.

---

## 131. Material Edit Concurrency

A material edit must be protected against simultaneous:

- admission
- withdrawal
- reschedule
- venue recovery
- cancellation
- another material edit

The domain must not allow two individually valid operations to combine into an
invalid final state.

Where necessary, the Plan itself becomes the serialization boundary for
material changes.

---

## 132. Withdrawal Invariants

Withdrawal must enforce:

1. Only applicable current member relationship may withdraw.

2. Duplicate retries do not create duplicate withdrawal history.

3. Current occupancy changes consistently.

4. Historical membership remains preserved.

5. Post-lock threshold consequences are evaluated.

6. Withdrawal cannot silently reactivate automatic Signal matching.

---

## 133. Controlled Seat Reopening Concurrency

When a post-lock Plan reopens one seat:

- exactly the authorized number of seats may reopen
- automatic Signal matching remains disabled
- capacity remains authoritative
- multiple applicants may request
- only the permitted number may ultimately be admitted

Two simultaneous approved applicants must not both claim one reopened seat.

---

## 134. Venue Recovery Invariants

Venue recovery must enforce:

1. Original locked venue remains historically preserved.

2. Only one current replacement venue becomes authoritative.

3. Recovery venue satisfies applicable eligibility.

4. Replacement must not fabricate new original selection history.

5. Attribution distinguishes original direction from redirection.

6. Completed/cancelled Plans cannot receive late venue recovery.

---

## 135. Venue Recovery Concurrency

If multiple eligible members attempt to finalize venue recovery simultaneously:

- only one authoritative replacement venue may result
- historical original venue remains unchanged
- current Plan venue changes once
- associated Plan History is created consistently
- attribution redirection cannot duplicate improperly

---

## 136. Rescheduling Invariants

Rescheduling must enforce:

1. Original schedule remains historically preserved.

2. One current schedule is authoritative.

3. Replacement schedule satisfies required hard constraints.

4. Venue validity is reevaluated where applicable.

5. Completed/cancelled Plans cannot be rescheduled.

6. Two conflicting reschedules cannot both become authoritative.

---

## 137. Cancellation Invariants

Cancellation must enforce:

1. Plan is in cancellable lifecycle state.

2. Actor/system has authorization.

3. Plan current lifecycle becomes cancelled exactly once.

4. Historical cancellation record is preserved.

5. Membership history remains preserved.

6. Venue/time history remains preserved.

7. Cancellation cannot be represented by deletion.

8. Late concurrent operations cannot reactivate cancelled Plan.

---

## 138. Cancellation Concurrency

Cancellation may race with:

- admission
- withdrawal
- venue recovery
- reschedule
- Plan activation
- material edit

Cancellation must establish one authoritative lifecycle outcome.

Operations that lose the race must observe cancellation and fail/no-op
appropriately.

---

## 139. Attendance Invariants

Attendance must enforce:

1. Attendance is not inferred solely from Plan membership.

2. Attendance evidence references valid user/Plan context.

3. Attendance associated with a venue references the applicable venue context.

4. Evidence classification remains explicit.

5. Multiple evidence sources must not silently create duplicate commercial
   attendance counts.

6. Attendance cannot fabricate verified spend.

---

## 140. Attribution Invariants

Venue attribution must enforce:

1. Attribution stage is explicit.

2. Venue is explicit.

3. Plan/group/journey context is preserved where applicable.

4. Sponsored campaign origin remains explicit.

5. A venue impression is not equivalent to direction.

6. Direction is not equivalent to attendance.

7. Attendance is not equivalent to verified spending.

8. Venue recovery preserves both original and redirected attribution.

9. Commercial aggregation must avoid duplicate counting of the same business
   outcome.

---

## 141. Economic Impact Invariants

Economic-impact records must enforce:

1. Estimate classification is explicit.

2. Benchmark/methodology provenance is preserved.

3. Verified spending remains distinct from estimated spending.

4. Redirected Plans must not have one attendance value counted as economic
   impact for multiple venues.

5. Historical methodology changes must not silently rewrite previously reported
   estimates without an explicit recalculation/versioning policy.

---

## 142. Admin Invariants

Administrative authority must enforce:

1. Admin privilege originates from explicit authoritative grant/role.

2. Ordinary users cannot self-grant admin access.

3. Sensitive administrative intervention is auditable.

4. Administrative action does not silently erase historical domain state.

5. Service-role capability is not equivalent to human admin identity.

---

## 143. Notification Invariants

Notifications must enforce:

1. Notification references authoritative event/context.

2. Notification creation failure must not roll back already-valid domain truth
   unless the operation explicitly requires transactional notification state.

3. Duplicate domain retries should not create uncontrolled duplicate critical
   notifications.

4. Read state does not affect underlying domain state.

---

## 144. Idempotency Doctrine

Critical client-callable domain operations should tolerate reasonable network
retry.

Where duplicate execution would be harmful, operations must support an
idempotency strategy.

Candidate operations include:

- Manual Plan creation
- Signal Intent activation
- confirmation
- admission
- Plan Lock
- cancellation
- venue recovery finalization
- rescheduling finalization

Idempotency may use:

- natural uniqueness
- request identifiers
- operation keys
- transaction-safe existing-result return
- another explicit mechanism

The exact implementation is operation-specific.

---

## 145. Database Time Doctrine

Authoritative deadlines use database/backend time.

Client device clocks are untrusted for:

- expiration
- confirmation deadline
- vote deadline
- runoff deadline
- final-call deadline
- Plan start transition
- recovery deadlines

Clients may render countdowns.

Database time determines whether an operation remains valid.

---

## 146. Locking Doctrine

Not every operation requires explicit row locking.

Critical transitions do.

The migration/domain design should prefer the narrowest reliable serialization
boundary.

Potential boundaries include:

- Signal Intent
- Signal Group
- Signal Group seat/member set
- Decision
- Decision Round
- Plan
- Admission Request

The purpose of locking is correctness, not blanket pessimistic locking.

---

## 147. Transaction Doctrine

Operations that establish multiple pieces of one domain truth must be
transactional.

Examples:

Manual Plan creation:
Plan + creator membership

Plan Lock:
Plan + memberships + group lock state

Admission:
request outcome + membership

Venue recovery:
Plan venue + Plan History + applicable attribution transition

Cancellation:
Plan lifecycle + Plan History

Partial truth is considered failure.

---

## 148. Derived Count Doctrine

Counts that can be derived from authoritative rows must not become independent
unprotected truth.

Examples:

- group member count
- confirmed count
- Plan occupancy
- vote totals
- venue directed-user count

Performance caches/materializations may be introduced later.

They must be rebuildable and must not override authoritative source rows.

---

## 149. Terminal-State Doctrine

Terminal domain states must be protected.

Examples may include:

- Signal Intent expired/withdrawn
- Signal Group completed/cancelled/expired
- Decision finalized
- Decision Round finalized
- Plan completed/cancelled
- Admission Request approved/rejected/expired
- Sponsored Campaign ended

Ordinary client operations must not return terminal records to earlier active
states.

Explicit authorized correction workflows, if ever introduced, must be separate
and auditable.

---

## 150. Concurrency Test Matrix

Before backend/frontend integration, concurrency tests must cover at minimum:

1. two workers attempt to assign same Signal Intent

2. two users race for final Signal Group seat

3. confirmation races with timeout/replacement

4. two votes from same user arrive concurrently

5. vote arrives while round finalizes

6. two finalizers attempt same voting round

7. two users race for final open Plan seat

8. creator approval races with another admission

9. admission vote finalization races with capacity exhaustion

10. two Plan Lock attempts occur simultaneously

11. member withdrawal races with Plan Lock

12. capacity edit races with admission

13. venue recovery finalizes twice

14. two reschedules finalize simultaneously

15. cancellation races with reschedule

16. cancellation races with admission

17. completed Plan receives late mutation attempt

18. duplicate network retry of critical operation

These tests are required gates before considering database domain operations
production-safe.

---

## 151. Failure-Test Matrix

Database/domain failure tests must cover at minimum:

- invalid user
- invalid city
- unauthorized city
- expired Signal Intent
- duplicate active intent
- ineligible crowd membership
- failed age/legal eligibility
- capacity full
- duplicate membership
- confirmation after deadline
- vote from ineligible user
- vote for option in wrong round
- vote after finalization
- insufficient participation
- invalid Plan origin
- Manual Plan missing creator
- Signal Plan missing originating group
- Plan Lock below threshold
- Plan Lock without required venue/time
- unauthorized admission
- admission after capacity fills
- capacity reduction below occupancy
- venue recovery on terminal Plan
- reschedule on terminal Plan
- unauthorized cancellation
- attendance without valid Plan context
- fabricated verified-spend attempt
- self-granted admin attempt

---

## 152. Operations Requiring Controlled Domain Boundary

The following initial operations should not be implemented as arbitrary chains
of direct frontend table writes:

- complete onboarding where cross-entity validation is required
- activate/replace Signal Intent
- form Signal Group
- claim/assign Signal Group membership
- confirm membership
- expire/replace membership
- cast/change vote where decision validation is required
- finalize voting round
- create Manual Plan
- open Plan admission
- approve admission
- finalize voted admission
- Plan Lock
- member withdrawal where recovery consequences apply
- reopen controlled seat
- finalize venue recovery
- finalize reschedule
- material Plan edit
- cancel Plan
- administrative intervention
- create verified attendance/spend evidence

G2.4 will classify exact client/API access and RLS boundaries.

---

## 153. G2.3 Status

Core invariants and concurrency boundaries are now defined.

The physical schema must be capable of enforcing these rules through an
appropriate combination of:

- keys
- foreign keys
- uniqueness
- checks
- partial uniqueness where appropriate
- transactional domain functions
- row/advisory locking where required
- RLS
- database-authoritative time
- idempotency

No exact SQL mechanism is locked by this section.

No migration is authorized yet.

Next gate:

G2.4 — RLS + Controlled Operation Matrix.


---

## 154. G2.4 Security Doctrine

SIGNAL treats every ordinary client as untrusted.

Authentication proves identity.

Authentication does not automatically grant authority to mutate every row owned
by that identity.

RLS determines which rows a client may access.

Controlled PostgreSQL/domain operations determine whether sensitive state
transitions are valid.

The initial security model distinguishes:

- anonymous/public access
- authenticated user access
- member-scoped access
- creator/governance access
- administrative access
- service/system access

Frontend visibility is not authorization.

---

## 155. RLS Principle

All client-accessible authoritative tables must have an explicit access model.

The architecture must not depend on:

- frontend routing
- hidden buttons
- disabled controls
- TypeScript-only validation
- React state
- secret assumptions about which screen calls an endpoint

If a row must not be readable or mutable by an ordinary client, PostgreSQL/RLS
or a controlled domain operation must enforce that rule.

---

## 156. Direct Read Doctrine

Direct authenticated SELECT may be appropriate when:

- row visibility is straightforward
- exposure does not reveal private/security-sensitive information
- row filtering can be safely expressed through RLS
- reading the row cannot itself violate a domain invariant

Examples may include applicable:

- public-safe profile fields
- city registry
- activity taxonomy
- eligible visible Plans
- visible venues
- current user's notifications
- current user's own membership records
- group state visible to an authorized group member

Direct read does not imply direct write.

---

## 157. Direct Write Doctrine

Direct client writes should be narrowly permitted.

A direct write is acceptable only when:

- the mutation affects one simple row or relationship
- invariant enforcement is local and database-enforceable
- no cross-entity transaction is required
- no complex concurrency decision is required
- authorization is expressible safely through RLS/check constraints

Examples may include limited low-risk state such as:

- editing permitted simple profile presentation fields
- marking own notification read
- certain private user preferences
- another explicitly reviewed simple mutation

Critical social transitions must not be exposed as arbitrary direct inserts,
updates, or deletes.

---

## 158. Controlled Domain Operation Doctrine

A controlled domain operation is required when a mutation involves:

- multiple tables/entities
- lifecycle transition
- capacity
- membership
- eligibility
- deadlines
- voting
- concurrency
- idempotency
- historical transition
- attribution side effects
- privileged authorization

These operations should execute through narrowly defined PostgreSQL functions or
an equivalent controlled backend boundary.

The function is not automatically trusted merely because it exists.

Each operation must:

- identify caller
- validate authorization
- validate current lifecycle state
- validate eligibility
- enforce invariants
- apply concurrency protection
- create required historical records
- return authoritative result

---

## 159. SECURITY DEFINER Doctrine

SECURITY DEFINER functions may be used only where elevated database authority is
genuinely required.

They must be narrow.

They must not become general RLS bypass tools.

Every SECURITY DEFINER function must:

- define a safe search_path
- identify/validate caller
- constrain target rows
- avoid caller-controlled object names
- validate authorization explicitly
- expose only required operation surface

Ordinary client use of a controlled function must not grant arbitrary database
power.

---

## 160. Anonymous Access

Anonymous users may receive only explicitly public information.

Possible V1 public-safe data may include:

- application metadata
- selected activity taxonomy
- selected city registry data
- limited public marketing content

Anonymous users must not receive:

- private profiles
- birth dates
- private location
- Signal membership
- private group coordination
- admission requests
- votes
- private Plan data
- attendance
- personal attribution records
- administrative data

Whether logged-out Plan browsing exists is a product/policy choice that can be
added explicitly later.

Migration 0001 should default to least privilege.

---

## 161. User Profile Read Boundary

A user may read their own complete permitted profile state.

Other authenticated users may read only the public-safe profile projection
required for social discovery.

Raw birth date must not be exposed through ordinary public profile reads.

Private/system fields must remain hidden from other ordinary users.

The physical design may use:

- RLS plus carefully selected columns/views
- separate private/public profile structures
- another enforceable projection

The architecture must not rely on frontend code to hide sensitive columns after
receiving them.

---

## 162. User Profile Write Boundary

A user may mutate only permitted self-editable profile fields.

The user must not directly mutate:

- administrative authority
- subscription entitlement
- arbitrary city access
- derived age-verification authority
- system moderation state
- another user's profile

Home-city changes require controlled entitlement-aware validation where policy
requires it.

Onboarding completion may require a controlled operation if completion spans
multiple validated fields/state transitions.

---

## 163. Geography Read Boundary

State, city, activity taxonomy, and similar platform configuration may be
directly readable where public exposure is safe.

Ordinary users must not directly mutate authoritative geography/configuration.

Geography mutation belongs to authorized administrative operations.

---

## 164. Entitlement Boundary

Users may read their own applicable entitlement state.

Ordinary users must not directly create, upgrade, modify, or delete:

- account entitlement
- Pro access
- additional city grants
- subscription authority

These are system/admin/billing-controlled records.

RLS must not permit a user to self-grant another city merely because the row
contains their own user_id.

---

## 165. Discovery Session Boundary

A user may create/read their own I'M BORED discovery session through applicable
controlled or constrained access.

A user may not read another user's private discovery history.

Discovery interaction writes may be accepted directly only if:

- ownership is enforced
- interaction type/reference is valid
- interaction cannot itself create authoritative social membership
- active intent creation remains separately controlled

Otherwise discovery interaction should pass through an intent-discovery domain
operation.

---

## 166. Signal Intent Read Boundary

A user may read their own Signal Intents.

Ordinary users must not receive unrestricted raw access to every user's active
Signal Intent.

Social opportunity surfaces should expose only the aggregate/member information
explicitly permitted by product privacy rules.

Compatible-user counts should be returned through controlled queries/views/
functions where necessary to prevent inference or leakage.

---

## 167. Signal Intent Write Boundary

Ordinary clients must not arbitrarily insert/update lifecycle fields on
Signal Intent.

Activation, replacement, withdrawal, and expiration-sensitive changes require
controlled domain operations where they affect matching authority.

A client may request:

- activate intent
- withdraw intent
- update permitted pre-assignment preferences

The database/domain operation decides whether the transition is valid.

Clients must not directly mark intent:

- assigned
- expired
- matched
- system-processed

---

## 168. Signal Group Read Boundary

A user may read Signal Group state where they have an authorized relationship
to that group or where a limited discovery projection is explicitly permitted.

Private group coordination data is member-scoped.

Ordinary unrelated users must not receive unrestricted access to:

- private membership details
- confirmation states
- coordination state
- votes
- private group conversation/coordination metadata

---

## 169. Signal Group Write Boundary

Ordinary clients must not directly mutate Signal Group lifecycle.

The following require controlled operations:

- formation
- activation
- confirmation transition
- coordination transition
- expiration
- cancellation
- Plan Lock
- completion/system lifecycle

Clients may request actions.

They do not write authoritative lifecycle values directly.

---

## 170. Signal Group Membership Read Boundary

A group member may read membership information required by product experience,
subject to privacy rules.

An ordinary unrelated user must not receive unrestricted group membership rows.

Profile information displayed for group members should come through public-safe
profile projections.

Private birth date, exact private location, or system-only eligibility data must
not leak through membership joins.

---

## 171. Signal Group Membership Write Boundary

Direct client insertion/deletion of Signal Group Membership is prohibited.

The following require controlled operations:

- automatic assignment
- seat claim
- confirmation
- decline
- timeout/replacement
- withdrawal
- backfill
- active-core establishment

Membership is one of SIGNAL's principal security boundaries.

---

## 172. Availability Read Boundary

A user may read their own availability.

Applicable group members may receive only the availability information needed
for coordination.

Exact private scheduling metadata should not be globally readable.

Availability may be presented as normalized coordination options rather than
exposing raw private availability where product privacy requires it.

---

## 173. Availability Write Boundary

A user may manage their own pre-lock availability only while the applicable
domain state permits changes.

Availability changes that affect:

- matching
- active core
- finalized time
- Plan Lock

must pass controlled validation.

A user must not directly edit another member's availability.

Post-lock time changes use rescheduling, not raw availability mutation.

---

## 174. Venue Read Boundary

Venue identity and ordinary public venue metadata may be directly readable.

Commercial/internal data must remain restricted.

Ordinary users must not directly mutate:

- sponsorship status
- platform ranking data
- attribution totals
- spend benchmarks
- business-partner relationships

---

## 175. Venue Candidate Write Boundary

Users may be permitted to suggest a venue through a controlled operation.

They must not directly fabricate:

- sponsored source
- platform-suggested source
- candidate eligibility
- winning venue
- attribution status

Venue Candidate creation must validate:

- group/Plan context
- caller eligibility
- venue existence/eligibility
- candidate source

---

## 176. Decision Read Boundary

Eligible participants may read decisions and rounds applicable to their
group/Plan.

Decision visibility must not expose private unrelated group data.

Finalized public-safe outcome may have broader visibility where product policy
permits.

---

## 177. Vote Write Boundary

Vote creation/change must use a controlled domain operation.

Clients must not directly insert arbitrary vote rows.

The operation must validate:

- caller is eligible voter
- round is open
- deadline has not passed
- option belongs to round
- vote change is permitted
- one authoritative vote per voter/round

Vote finalization is never client-controlled direct mutation.

---

## 178. Decision Finalization Boundary

Finalization is system/domain-controlled.

An ordinary user may trigger/request evaluation where product UX requires it.

The database decides whether:

- deadline reached
- participation satisfied
- winner exists
- runoff required
- final-call required
- deterministic tie resolution required

The caller does not submit the authoritative winner.

---

## 179. Plan Read Boundary

Plan visibility depends on:

- publication state
- city entitlement
- membership
- admission state
- lifecycle
- privacy settings

A public/discoverable Plan may expose a safe summary.

Members may receive richer Plan data.

Private/system fields remain restricted.

A user's My Plans view derives from authoritative creator/membership
relationships.

---

## 180. Manual Plan Creation Boundary

Manual Plan creation must use a controlled domain operation.

The operation atomically validates/creates:

- creator
- origin
- city entitlement
- creator eligibility
- Plan
- creator Plan Membership
- capacity
- admission mode
- applicable venue/time configuration

Ordinary clients must not directly insert arbitrary Plan rows and then fabricate
creator membership.

---

## 181. Plan Membership Read Boundary

A Plan member may read membership information required by the Plan experience.

An admission applicant may read only the request/Plan information permitted by
policy.

Unrelated users must not receive unrestricted Plan Membership data.

---

## 182. Plan Membership Write Boundary

Direct client insert/update/delete of Plan Membership is prohibited.

Membership changes require controlled operations such as:

- open admission
- creator-approved admission
- group-vote admission
- controlled post-lock admission
- withdrawal
- administrative correction where authorized

---

## 183. Admission Request Boundary

An eligible user may request admission through a controlled operation.

The caller may read their own request.

Applicable Plan governance participants may read requests they are permitted to
decide.

Ordinary unrelated users may not browse admission requests.

Approval/rejection/finalization must not be implemented as arbitrary client
updates.

---

## 184. Plan Edit Boundary

Safe simple edits may potentially use constrained direct update where G3 proves
that no cross-entity invariant is affected.

Material edits require controlled operations.

Material fields include applicable:

- city
- capacity
- crowd eligibility
- age eligibility
- venue
- schedule
- admission mode
- lifecycle
- cancellation

The implementation should default to controlled mutation until a field is
proven safe for direct update.

---

## 185. Plan Lock Boundary

Plan Lock is controlled domain-only.

The client may request lock.

The client must not submit a trusted payload claiming:

- member count is valid
- venue vote won
- time is finalized
- eligibility passed
- group is ready

The operation reads authoritative database state and decides.

---

## 186. Recovery Boundary

The following are controlled domain operations:

- reopen seat
- venue recovery initiation/finalization
- rescheduling initiation/finalization
- recovery decision
- cancellation after lock
- active-outing correction

Ordinary clients must not directly rewrite current Plan venue/time/lifecycle to
simulate recovery.

---

## 187. Attendance Boundary

Ordinary users may create permitted self-reported attendance evidence through a
controlled/constrained operation.

Users must not directly fabricate:

- partner verification
- system verification
- another user's attendance
- business analytics totals

Stronger attendance evidence is service/system/partner-controlled.

---

## 188. Attribution Boundary

Ordinary clients must not receive unrestricted direct INSERT/UPDATE authority
over venue attribution records.

Attribution is created by trusted domain operations or service/system processes
in response to authoritative actions.

Examples:

- venue candidate shown
- venue viewed
- vote
- selected venue
- Plan Lock
- directions action
- redirect
- attendance evidence

Where client interaction is the source of an attribution event, the controlled
operation must validate context rather than trusting arbitrary venue/Plan
identifiers.

---

## 189. Economic Impact Boundary

Ordinary users and venues must not directly write authoritative commercial
impact values.

Spend Benchmarks are admin/system/business-data controlled.

Economic Impact Records are system-calculated or verified through explicit
evidence pathways.

User voluntary spend reporting, if introduced, is input evidence.

It is not itself unrestricted authority to write final venue economic-impact
totals.

---

## 190. Notification Boundary

A user may read their own Notifications.

A user may mark their own notification read.

Ordinary users must not fabricate system notifications for other users.

Notification creation belongs to domain/system operations.

---

## 191. Admin Boundary

Administrative access requires explicit authoritative Admin Grant/Platform Role.

Admin access must be capability-scoped where practical.

Potential capability areas include:

- geography
- activity taxonomy
- venue management
- business relationships
- sponsorship
- moderation
- analytics
- authorized recovery/correction
- user/account support

"admin = true" on an editable profile row is prohibited.

---

## 192. Service/System Boundary

Service/system authority exists for trusted backend operations that ordinary
authenticated users cannot perform.

Examples may include:

- expiration processing
- matching/group formation
- backfill
- scheduled decision finalization
- notification creation
- attribution processing
- economic-impact calculation
- maintenance
- billing/entitlement synchronization

Service-role authority must remain server-side.

It must never be exposed in frontend environment variables.

---

## 193. Publishable Client Key Boundary

Supabase publishable/anon client credentials are not secrets.

They identify the public client context.

Security must not depend on hiding the publishable key.

The publishable client receives only the capabilities granted through:

- authentication
- RLS
- database grants
- controlled functions

Privileged service credentials must never ship to the browser.

---

## 194. Initial Read Matrix

Conceptually:

### User Profile

Self:
full permitted read

Other authenticated users:
public-safe projection only

Anonymous:
no private profile access

### State / City / Activity / Venue public metadata

Authenticated:
read

Anonymous:
read where explicitly public

### Entitlement

Self:
read own

Others:
no

Admin/system:
authorized read/write

### Discovery

Self:
read own

Others:
no

### Signal Intent

Self:
read own

Other ordinary users:
no raw unrestricted read

Matching system:
authorized access

### Signal Group

Member:
authorized read

Unrelated user:
no private group read

### Group Membership

Member:
authorized group-scoped read

Unrelated user:
no

### Decision / Vote

Eligible participant:
authorized decision read

Unrelated user:
no private read

### Plan

Discoverable eligible user:
safe Plan projection

Member:
richer Plan read

Creator:
governance-relevant read

### Admission Request

Applicant:
own request

Authorized Plan governance:
applicable requests

Others:
no

### Attendance / Attribution / Economic Impact

Ordinary user:
only permitted personal/product projections

Business/admin/system:
aggregate/authorized views

Raw unrestricted analytics:
not ordinary-client accessible

---

## 195. Initial Write Matrix

### User Profile

Direct constrained:
safe self-edit fields

Controlled:
home-city/onboarding-sensitive changes where needed

### Geography / Activity Configuration

Ordinary user:
no write

Admin:
controlled write

### Entitlement

Ordinary user:
no write

Billing/admin/system:
controlled write

### Discovery Interaction

Self:
constrained or controlled

### Signal Intent

Controlled domain operation

### Signal Group

Controlled/system operation

### Signal Group Membership

Controlled/system operation

### Availability

Self:
constrained only while domain permits

Critical coordination change:
controlled operation

### Venue Candidate

Controlled suggestion/platform operation

### Vote

Controlled operation

### Decision Finalization

Controlled/system operation

### Manual Plan

Controlled creation

### Plan Membership

Controlled operation

### Admission Request

Controlled request/finalization

### Material Plan Edit

Controlled operation

### Plan Lock

Controlled operation

### Recovery / Reschedule / Cancellation

Controlled operation

### Attendance Evidence

Controlled/constrained evidence submission

### Attribution

Controlled/system operation

### Economic Impact

System/admin/verified evidence pipeline

### Notification

System creates
Self may mark read

### Administrative Action

Controlled admin operation

---

## 196. Initial Controlled Operation Inventory

Initial PostgreSQL/domain operations are expected to include conceptual
operations such as:

1. complete_onboarding

2. change_home_city

3. activate_signal_intent

4. withdraw_signal_intent

5. form_signal_group

6. assign_signal_group_member

7. confirm_signal_group_member

8. decline_signal_group_member

9. expire_or_replace_group_member

10. create_venue_candidate

11. cast_vote

12. finalize_decision_round

13. create_manual_plan

14. request_plan_admission

15. join_open_plan

16. approve_plan_admission

17. reject_plan_admission

18. finalize_voted_admission

19. lock_signal_plan

20. withdraw_plan_member

21. reopen_plan_seat

22. finalize_venue_recovery

23. finalize_reschedule

24. apply_material_plan_edit

25. cancel_plan

26. submit_attendance_evidence

27. administrative_domain_action

Names are conceptual.

Migration design may refine names and split operations where clearer security or
atomicity requires it.

---

## 197. System Operation Inventory

System/scheduled operations may include:

- expire Signal Intents
- process matching
- form eligible groups
- expire confirmations
- backfill groups
- evaluate decision deadlines
- create runoff
- apply deterministic tie resolution
- process final-call deadlines
- transition Plan to active outing
- transition eligible Plan to completed
- generate notifications
- record derived attribution
- calculate economic impact
- synchronize billing entitlement

System operations must remain idempotent where repeated scheduling may occur.

---

## 198. Administrative Operation Inventory

Initial administrative operations may include:

- manage states/cities
- manage activities/categories/vibes
- manage venue registry
- manage business relationships
- manage sponsored campaigns
- grant/revoke explicit admin capability
- moderate user-generated content
- perform authorized domain correction
- inspect platform analytics
- inspect aggregate venue impact

Administrative correction must be distinguished from ordinary domain mutation.

Sensitive intervention should produce Administrative Action history.

---

## 199. Client Exposure Doctrine

The browser should primarily interact with SIGNAL through:

- safe RLS-protected SELECTs
- safe constrained self-writes
- controlled domain functions

The browser must not contain:

- service-role key
- privileged database credentials
- secret admin bypass
- trusted calculations for domain authority

The client may calculate presentation.

PostgreSQL determines authoritative state.

---

## 200. RLS Testing Requirements

Before frontend integration, RLS tests must verify at minimum:

1. user cannot read another user's private birth date

2. user cannot edit another profile

3. user cannot self-grant Pro

4. user cannot self-grant another city

5. unrelated user cannot read private Signal Group state

6. user cannot directly insert Signal Group Membership

7. user cannot directly alter Signal Group lifecycle

8. user cannot fabricate vote row

9. user cannot finalize vote by direct update

10. user cannot directly insert Plan Membership

11. user cannot exceed Plan capacity through direct API writes

12. user cannot change Plan origin

13. user cannot fabricate creator for Signal-origin Plan

14. user cannot directly set Plan locked

15. user cannot directly rewrite locked venue/time

16. user cannot fabricate attendance verification

17. user cannot fabricate attribution

18. user cannot fabricate economic-impact value

19. user cannot self-grant admin

20. anonymous user cannot access private social data

These tests are mandatory before declaring RLS production-safe.

---

## 201. Controlled Operation Testing Requirements

Controlled operations must be tested for:

- unauthenticated caller
- wrong user
- wrong membership
- wrong city
- invalid lifecycle
- expired deadline
- ineligible applicant
- capacity exhausted
- duplicate retry
- concurrency race
- unauthorized admin action
- terminal record
- manipulated input identifiers
- RLS interaction
- function execution privileges

Passing happy-path tests alone is insufficient.

---

## 202. Function Grant Doctrine

Controlled functions must receive explicit execution grants.

A function existing in the database does not mean every role should execute it.

Migration design must specify whether execution belongs to:

- authenticated
- service/system
- admin capability
- another restricted role

Public/anonymous EXECUTE should be denied unless explicitly required.

Default function privilege behavior must not be assumed safe without
verification.

---

## 203. Table Grant Doctrine

Migration design must explicitly consider table privileges in addition to RLS.

RLS is not a substitute for careless broad grants.

Where a client does not need direct INSERT/UPDATE/DELETE authority on a critical
table, the role should not receive it merely because policies exist.

Use least privilege.

---

## 204. Storage Boundary

Profile photo media will use Supabase Storage or equivalent object storage.

Storage security must enforce:

- users can upload only through permitted paths/policies
- users cannot overwrite another user's private objects
- avatar/public media visibility matches product policy
- database profile reference does not grant storage write authority
- deleted/replaced media follows explicit cleanup policy

Storage RLS/policies are part of later implementation gates.

They must be tested separately from PostgreSQL table RLS.

---

## 205. Realtime Security Boundary

Realtime must respect underlying access rules.

A user must not gain private row visibility merely by subscribing to a Realtime
channel/table.

Realtime publications/subscriptions should include only domains that require
live updates.

Potential V1 live domains include:

- group membership/confirmation
- decisions/votes
- Plan state
- admission
- recovery
- notifications

Sensitive analytics/admin data should not be published broadly.

---

## 206. Database Function Result Doctrine

Controlled functions should return the minimum authoritative result needed by
the caller.

They should not expose internal private rows merely because the function has
elevated execution authority.

SECURITY DEFINER result shape must be treated as part of the security boundary.

---

## 207. Error Doctrine

Controlled operations should fail predictably.

The domain should distinguish meaningful cases such as:

- unauthenticated
- unauthorized
- not eligible
- expired
- capacity full
- already member
- already finalized
- invalid lifecycle
- conflict/retry required

The frontend may translate these errors into user-facing language.

The database must not leak sensitive internal data through error messages.

---

## 208. G2.4 Access Classification Summary

### Safe direct reads

Public/configuration data and authorized current-state projections protected by
RLS.

### Safe constrained direct writes

Only low-risk self-owned fields whose invariants are local and enforceable.

### Controlled user operations

Critical social-domain transitions requested by authenticated users.

### System operations

Matching, expiration, scheduling, notification, attribution, economic-impact,
and other trusted automation.

### Administrative operations

Explicit capability-scoped platform management/intervention.

### Prohibited direct client mutation

Membership, lifecycle, voting authority, Plan Lock, capacity-critical
admission, attribution, verified attendance/spend, entitlement, admin grants.

---

## 209. G2.4 Status

The initial RLS/access model and controlled operation boundaries are defined.

G2 now contains:

- domain boundaries
- candidate entities
- relationship map
- authority map
- invariants
- concurrency model
- failure-test matrix
- RLS doctrine
- read/write matrix
- controlled operation inventory
- system/admin operation boundaries
- storage boundary
- Realtime security boundary

The database blueprint is now ready for closure review.

No migration has been written yet.

Next gate:

G2.5 — Blueprint Closure + Freeze.

After G2.5 passes:

G3.0 — Migration 0001 Physical Schema Design.
