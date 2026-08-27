# SIGNAL Product Contract

Status: DRAFT — G1 Architecture Gate

This document defines the authoritative product and domain rules for SIGNAL.

No database schema, backend domain operation, Realtime behavior, or frontend
implementation may contradict this contract.

---

## 1. Product Purpose

SIGNAL is a social discovery product designed to move people from passive
interest to real-world activity.

The primary experience is not traditional event creation.

The primary experience is SIGNAL:

1. A user expresses lightweight intent around something they would like to do.
2. Other compatible users express overlapping intent.
3. SIGNAL detects meaningful convergence.
4. A social group can form around that convergence.
5. The group progresses toward a real-world Plan.
6. The product helps prevent inactivity from permanently stalling the Plan.

Manual Plan creation remains supported as a secondary workflow.

---

## 2. User Identity

Every authenticated user has exactly one application profile.

A completed profile requires:

- authenticated account
- display identity
- profile photo
- home city
- home state

Profile photo is mandatory.

Users may:

- upload an existing photo from their device
- take a new photo on supported devices

Bio is optional but encouraged.

Birthday is optional but encouraged.

If birthday is supplied, the application may derive and display age.

The user's raw birthday must not be publicly displayed merely because age is
displayed.

---

## 3. Geographic Identity

Cities and states are canonical platform data.

Users do not establish their home city using unrestricted arbitrary text.

During onboarding, the user selects a supported city/state from the platform's
geographic registry.

The selected city becomes the user's home city.

The home city determines the user's default local social experience.

---

## 4. City Access

A standard/free user belongs to a home-city experience.

Free users do not receive unrestricted access to other city timelines.

Paid/Pro entitlement may permit access to additional city experiences.

Geographic access must be enforceable outside of frontend navigation.

The frontend hiding another city is not considered sufficient authorization.

---

## 5. SIGNAL

A Signal represents social intent.

A Signal is not automatically a finalized event.

Signal activity can attract compatible users around:

- an activity
- an interest
- a place category
- a time window
- another supported intent dimension

The system may use compatible intent to form a candidate social group.

Group formation must be deterministic enough to test.

The database/domain layer must prevent invalid duplicate membership and
contradictory state.

---

## 6. Plans

A Plan represents a more concrete real-world activity.

Plans may originate from:

1. SIGNAL-driven group formation
2. manual Plan creation

Manual Plan creation is secondary to the SIGNAL discovery experience but is a
first-class supported workflow.

Plan lifecycle state must be explicit.

Critical Plan transitions must not depend solely on React state.

---

## 7. Membership

Plan/group membership is controlled.

A creator must not need to join their own Plan as an ordinary applicant.

The creator is already part of the Plan/group according to the domain rules.

A non-member may request admission where admission is permitted.

Existing eligible members may inspect the applicant's permitted profile
information before deciding.

Admission decisions may use member voting.

Majority-based admission must have one deterministic definition.

The system must prevent:

- duplicate membership
- duplicate active admission requests where prohibited
- duplicate votes from the same eligible voter
- voting by ineligible users
- unauthorized direct membership insertion

---

## 8. Voting

Voting is domain state, not frontend-only state.

Voting may be used for:

- membership admission
- place selection
- other future group decisions

Every voting mechanism must explicitly define:

- eligible voters
- eligible choices
- opening condition
- closing condition
- deadline behavior
- quorum behavior where applicable
- majority/winner calculation
- tie behavior
- no-vote behavior
- finalization behavior

Finalized outcomes must be protected against conflicting concurrent writes.

---

## 9. Activity and Replacement

Inactive members must not be able to stall a group indefinitely.

The system must support deterministic activity/deadline rules.

When required participation does not occur within the applicable window, the
domain may make inactive positions replaceable.

Replacement must be controlled by explicit state transitions.

The system must never remove or replace members based only on a browser timer.

---

## 10. Places

Users/groups may propose or vote on places.

The platform may also provide local place suggestions.

Future administrative or commercial relationships may allow promoted/sponsored
places to be suggested.

Sponsored placement must be represented explicitly.

Sponsored data must not silently masquerade as organic recommendation data.

The architecture must support organic and sponsored suggestions without
requiring a future destructive redesign.

---

## 11. Realtime

Realtime communicates authoritative shared-state changes.

Realtime does not replace database correctness.

Examples of state suitable for Realtime propagation include:

- membership changes
- admission request changes
- vote changes
- Plan lifecycle changes
- Signal/group formation changes

A client missing a Realtime event must still be able to reload authoritative
state from the backend.

---

## 12. Authorization

Frontend visibility is not authorization.

Critical permissions must be enforceable by the backend/database security
model.

The architecture must account for:

- ordinary users
- paid/Pro entitlements
- administrative capabilities
- future platform-operated functionality

No privileged behavior may depend on a user-editable frontend flag.

---

## 13. Concurrency

SIGNAL is a multi-user system.

The architecture must assume that multiple users can act at nearly the same
time.

Critical operations must define behavior for concurrent:

- join/admission requests
- votes
- group formation
- finalization
- member replacement
- Plan transitions

Where correctness depends on atomicity, the operation belongs in the database
transaction/domain boundary rather than a chain of independent browser writes.

---

## 14. Product Experience

SIGNAL should feel premium, fluid, tactile, and alive.

The desired interaction quality includes:

- smooth motion
- responsive transitions
- tactile cards
- layered depth
- polished gestures
- fluid state changes

The inspiration is the quality and physicality of premium swipe-oriented
consumer applications, not copying another application's layout.

Desktop and mobile share the same product language.

Interaction mechanics may adapt to the device.

Mobile may use direct touch/swipe gestures.

Desktop may use pointer, drag, click, keyboard, and trackpad interactions.

---

## 15. Engineering Doctrine

Development follows this gate order:

Architecture
→ Migration
→ Database Verification
→ Concurrency / Failure Tests
→ Backend Domain Layer
→ Realtime
→ Frontend
→ Browser Verification
→ Checkpoint

Rules:

- No patch chains.
- No guessing at production schema.
- No fake owners.
- No frontend business logic that belongs in PostgreSQL.
- No "we'll clean it up later."
- No changing multiple unrelated things before verifying the first thing.
- Every critical invariant must have one authoritative owner.
- Every gate must be verified before advancing.

---

## 16. G1 Architecture Questions — CLOSED

This section originally recorded architecture questions that had to be resolved
before the G1 product contract could be frozen.

Those questions included:

- Signal compatibility
- Signal expiration
- group formation thresholds
- minimum/target/maximum group size
- admission voting
- venue voting
- tie resolution
- inactivity
- replacement eligibility
- Plan lifecycle
- Signal lifecycle
- Free vs Pro entitlement behavior
- multi-city behavior
- administrative boundaries
- sponsored-place behavior

These questions were intentionally recorded before implementation so that they
would not be invented implicitly while writing UI or database code.

They are now CLOSED.

The authoritative answers are defined by the locked domain decisions in the
sections that follow, including later amendments through Section 175.

This historical section is not an open-decision list.

If a future implementation discovers a genuine contradiction or missing
invariant, development must stop and the contract must be explicitly amended
rather than silently inventing behavior.


---

# G1 LOCKED DOMAIN DECISIONS

The following decisions supersede corresponding unresolved items above.

## 17. Signal Pool Architecture

A Signal represents a pool of compatible active intent.

A Signal pool may produce:

- zero groups
- one group
- many groups

The architecture must never assume one Signal equals one group.

Example:

137 compatible users may participate in the same Drinks Tonight Signal pool
while the grouping engine creates multiple independent social groups from that
pool.

Each resulting group has its own membership and lifecycle.

Overflow users remain eligible for additional group formation where appropriate.

---

## 18. Replaceable Grouping Engine

Group formation strategy must be replaceable.

The database must store authoritative intent, eligibility, membership, and group
state without embedding one permanent matching algorithm into the schema.

V1 may use a deterministic first-compatible grouping policy.

Future grouping policies may consider additional dimensions such as:

- proximity
- neighborhood
- availability
- user preferences
- reliability
- compatibility
- other future matching signals

Replacing the grouping policy must not require destructive redesign of the core
Signal, intent, group, or membership model.

---

## 19. Initial Group Size Policy

The initial SIGNAL social grouping policy is:

- activation threshold: 4 compatible users
- target capacity: 6 users
- maximum automatic capacity: 6 users

At four compatible matched users, the Signal Group may activate.

The group may continue filling seats five and six after activation.

Compatible overflow remains available for other groups.

These numbers belong to grouping policy/configuration.

The architecture must permit future activities or modes to use different group
size policies without schema redesign.

---

## 20. Matched vs Confirmed

Automatic matching does not equal confirmed participation.

Membership participation state must distinguish at minimum between:

- matched
- confirmed

When a Signal Group activates, matched users receive an opportunity to confirm
participation.

Confirmation deadlines are authoritative backend/domain timestamps.

Browser timers are presentation only.

Confirmation timing may depend on the urgency of the activity.

Immediate activities may use shorter confirmation windows than future
activities.

A non-responsive matched participant may become replaceable according to the
grouping/recovery policy.

---

## 21. Recovery and Backfill

A Signal Group should not immediately die merely because one matched user fails
to confirm.

The system may reopen that seat and attempt to backfill it from compatible
active intent remaining in the Signal pool.

The group may continue operating during an applicable recovery window.

If participation cannot be recovered before the activity becomes impractical,
the group may expire according to explicit lifecycle rules.

Group death, expiration, replacement, and backfill are backend/domain state
transitions.

---

## 22. Crowd Eligibility

SIGNAL must support intentional crowd eligibility.

Initial supported crowd modes:

- Everyone
- Women Only
- Men Only

Crowd eligibility is an enforced membership rule, not merely UI text.

An ineligible user must not be able to enter a restricted Signal Group or Plan
through direct navigation, manipulated frontend state, or direct database
writes.

Crowd eligibility is one matching dimension and must not require separate
grouping systems for each crowd mode.

---

## 23. Age and Eligibility

SIGNAL must support age eligibility.

Examples include:

- 21+
- minimum age
- maximum age
- age range

Age preference and mandatory legal/venue eligibility are distinct concepts.

A venue or activity restriction such as 21+ is mandatory eligibility.

Birthday remains private profile data.

Public product surfaces may display derived age where appropriate.

Raw birthday must not be exposed merely because age is displayed.

If birthday/age verification information is absent, the user may continue using
unrestricted SIGNAL functionality but may be ineligible for age-restricted
Signals or Plans until eligibility can be established.

Eligibility enforcement belongs to the backend/domain security boundary.

---

## 24. Geographic Matching

City is the primary Signal pool boundary for standard/free access.

Within a city, SIGNAL may use proximity to improve group formation.

Initial matching concepts include:

- city
- neighborhood/area
- preferred radius
- approximate proximity

Neighborhood and radius may be soft preferences unless explicitly defined as
strict.

Exact user location must not be casually exposed to other users.

Internal matching may use appropriate location information without making that
location public.

The selected venue becomes the relevant shared destination once a Plan is
formed.

---

## 25. Time Compatibility

Signal time is structured domain data.

The system may support experiences such as:

- Now
- Tonight
- Tomorrow
- This Weekend
- specific date/time windows

These labels must resolve to authoritative time ranges.

Users may be compatible when their availability windows meaningfully overlap.

Exact equality of availability windows is not required.

Every active Signal intent must have an authoritative expiration time.

Expired intent must not continue matching users.

Urgency may influence:

- confirmation deadlines
- replacement windows
- coordination deadlines
- group expiration

These deadlines are backend/domain state, not frontend-only timers.

---

## 26. Venue Attribution

Venue attribution is first-class domain data.

SIGNAL must be able to measure the funnel through which the platform directs
real-world activity toward venues.

Attribution concepts may include:

- venue impression
- venue view/consideration
- venue vote
- venue selection
- directions opened
- Plan locked for venue
- people directed
- attendance evidence
- confirmed attendance

Historical commercial attribution must not be reconstructed solely from current
mutable Plan state.

Important attribution actions should produce durable historical records/events.

---

## 27. Venue Suggestion Source

The system must distinguish venue suggestion origin.

Initial source concepts include:

- organic
- member suggested
- platform suggested
- sponsored

Sponsored placement must be explicitly represented.

Sponsorship must not fabricate votes, popularity, attendance, or organic
selection.

Future sponsored campaigns may target eligible Signal contexts such as:

- city
- activity
- date/time
- venue category

Campaign attribution must remain measurable independently from organic
attribution.

---

## 28. Economic Impact Attribution

SIGNAL must support estimating the economic value it directs toward venues.

Estimated value must remain distinguishable from verified transaction value.

A conceptual estimate may use:

people directed × estimated average spend per attendee

Average-spend estimates must not be permanently hard-coded as one global value.

Spend models may eventually vary by:

- venue
- venue category
- city
- activity
- time period
- platform benchmark
- venue-provided average ticket
- SIGNAL-derived historical data

Potential future evidence may include voluntary user spend ranges, venue
integrations, or transaction/partner data.

The system must preserve the provenance/basis of an estimate.

Commercial reporting must clearly distinguish concepts such as:

- estimated directed value
- estimated confirmed-attendance value
- verified spend

SIGNAL must never present estimated spending as verified revenue.

---

## 29. Business Analytics Privacy

Venue/business-facing reporting should normally expose aggregate performance
rather than individual user identity.

A business may eventually see metrics such as:

- Plans selecting the venue
- people directed
- attendance evidence
- estimated economic value
- campaign performance
- activity/category trends

The commercial analytics architecture must not require exposing the identities
of individual SIGNAL users to participating venues.

---

## 30. Initial Matching Order

The initial deterministic grouping policy should conceptually evaluate:

1. active/unexpired intent
2. same eligible city pool
3. compatible activity
4. compatible time window
5. crowd eligibility
6. mandatory age/activity/venue eligibility
7. proximity and other applicable soft preferences
8. grouping-policy capacity

At four compatible users, the initial policy may activate a group.

The grouping engine then continues filling toward six while respecting
eligibility and lifecycle rules.

This matching order is an initial policy, not a permanent schema limitation.


---

## 31. Signal Intent Lifecycle

A Signal intent represents a user's active expression of interest.

Initial intent states are conceptually:

- active
- assigned
- withdrawn
- expired

Active intent may participate in matching.

Assigned intent has been associated with a Signal Group according to the
grouping policy.

Withdrawal is an explicit user/domain action.

Expiration is determined by authoritative backend time.

Browser state must not determine whether intent remains eligible for matching.

Assignment must preserve sufficient history to understand how a group was
formed.

---

## 32. Signal Group Lifecycle

A Signal Group has an explicit lifecycle.

The initial lifecycle is conceptually:

forming
→ confirming
→ coordinating
→ locked
→ active_outing
→ completed

Terminal outcomes may include:

- cancelled
- expired

Group lifecycle state is authoritative backend/domain state.

The frontend may render group state but must not independently invent or
finalize lifecycle transitions.

---

## 33. Forming

A group begins in forming state while SIGNAL assembles compatible eligible
members from a Signal pool.

The initial grouping policy activates the group when four compatible members
have been matched.

A forming group must not exceed the applicable grouping-policy capacity.

For the initial policy:

- activation threshold = 4
- target capacity = 6
- maximum automatic capacity = 6

---

## 34. Confirming

When the activation threshold is reached, the group may transition from forming
to confirming.

Matched users are asked to confirm participation.

Matched participation and confirmed participation are distinct states.

Confirmation deadlines are authoritative backend/domain timestamps.

A matched user may:

- confirm
- decline
- fail to respond before the applicable deadline

A declined or timed-out seat may become replaceable according to recovery
policy.

The group may continue attempting to fill available eligible seats while
confirmation occurs.

---

## 35. Coordination Threshold

The initial coordination threshold is four confirmed eligible members.

A group does not need six confirmed members before coordination begins.

When at least four eligible members are confirmed, the group may transition to
coordinating.

This preserves the product rule that four people are sufficient to create
social momentum.

Seats five and six may continue to be automatically filled while the group is
coordinating.

The automatic capacity remains six for the initial policy.

---

## 36. Coordinating

During coordinating state, confirmed members may perform the decisions needed
to convert social intent into a concrete Plan.

Coordination may include:

- venue suggestions
- venue voting
- time refinement
- other required group decisions
- group conversation or other future coordination surfaces

The precise decisions required for Plan Lock must be explicit and testable.

Coordination state must not permit automatic membership beyond the applicable
group capacity.

---

## 37. Automatic Fill Cutoff

Automatic Signal matching into a group is permitted only before Plan Lock.

During forming, confirming, and coordinating, available seats may be filled
according to grouping and recovery policy.

Once the group transitions to locked:

- automatic matching into that group stops
- automatic backfill into that group stops
- membership is frozen against automatic additions

This rule prevents a finalized real-world Plan from unexpectedly changing
membership through the matching engine.

---

## 38. Plan Lock

Plan Lock represents the transition from an organizing Signal Group into a
concrete real-world Plan.

The requirements for Plan Lock must be explicit domain rules.

At minimum, the initial Signal-generated Plan must have sufficient authoritative
information to identify:

- the activity
- the selected destination/venue where applicable
- the scheduled time or applicable activity window
- the confirmed membership
- the originating Signal Group

Plan Lock must be performed as a controlled backend/domain operation.

Concurrent attempts to finalize conflicting Plan outcomes must not produce
multiple contradictory locked results.

---

## 39. Membership After Plan Lock

After Plan Lock, the automatic grouping engine may not insert additional
members.

A non-member wishing to enter a locked Plan must use the controlled admission
workflow where admission remains permitted.

That workflow may include:

- admission request
- permitted profile inspection
- eligible-member voting
- deterministic majority/finalization
- controlled membership insertion

Direct membership insertion must not bypass eligibility, capacity,
authorization, or admission rules.

This preserves the distinction between:

1. automatic Signal formation before Plan Lock
2. deliberate Plan admission after Plan Lock

---

## 40. Active Outing

A locked Plan may transition to active_outing when the applicable scheduled
activity window begins according to authoritative time rules.

Active-outing functionality may eventually include:

- directions
- arrival evidence
- attendance evidence
- venue interaction
- other real-world coordination

The architecture must not require constant precise public sharing of member
locations.

---

## 41. Completion

A Plan/Group may transition to completed after the applicable outing has ended
according to explicit domain rules.

Completion preserves historical state.

Completion may enable later product functionality such as:

- attendance confirmation
- lightweight feedback
- optional spend-range reporting
- venue impact attribution
- reliability signals
- future recommendation inputs

Completion must not erase the historical relationship between:

Signal intent
→ Signal Group
→ confirmed membership
→ venue decision
→ locked Plan
→ attendance/economic attribution

---

## 42. Cancellation and Expiration

Cancellation and expiration are distinct concepts.

Cancellation represents an explicit permitted domain action that terminates a
group or Plan.

Expiration represents failure to progress within an authoritative lifecycle
window or the passing of an applicable opportunity window.

The system must record enough information to distinguish these outcomes.

A browser closing, refreshing, disconnecting, or missing a Realtime event must
not itself cancel or expire authoritative group state.

---

## 43. Backfill During Lifecycle

Backfill is a recovery behavior, not a standalone group lifecycle state.

Backfill may occur during applicable pre-lock lifecycle states when:

- a matched user declines
- a confirmation deadline expires
- an eligible seat becomes vacant
- participation falls below a recoverable threshold

Backfill must respect:

- Signal compatibility
- crowd eligibility
- age/legal eligibility
- city eligibility
- applicable time compatibility
- group capacity
- lifecycle state

Backfill ends when Plan Lock occurs.

---

## 44. Lifecycle Invariants

The initial lifecycle must enforce at least the following invariants:

1. A user cannot occupy duplicate membership in the same group.

2. A group cannot automatically exceed its grouping-policy capacity.

3. Coordination cannot begin under the initial policy without at least four
   confirmed eligible members.

4. Plan Lock cannot occur from an invalid lifecycle state.

5. Automatic membership cannot occur after Plan Lock.

6. Completed, cancelled, or expired groups cannot silently return to an active
   lifecycle state.

7. Confirmation deadlines and expiration are backend-authoritative.

8. Realtime events communicate lifecycle changes but do not create lifecycle
   truth.

9. Concurrent lifecycle actions must not create contradictory authoritative
   outcomes.

10. Historical attribution must survive lifecycle completion.

---

## 45. Initial End-to-End Signal Path

The initial successful SIGNAL path is:

User selects I'M DOWN
→ active Signal intent
→ compatible pool participation
→ group forming
→ four compatible users matched
→ group confirming
→ four eligible members confirmed
→ group coordinating
→ optional seats five and six continue filling
→ required venue/time decisions finalize
→ Plan Lock
→ automatic membership freezes
→ locked Plan
→ active outing
→ completion

Recovery paths may branch from this flow without violating the lifecycle
invariants defined above.


---

## 46. Group Decision Framework

Group voting is authoritative domain state.

A vote displayed by the frontend must correspond to authoritative backend data.

The initial group-decision framework must explicitly define:

- decision type
- eligible voters
- eligible choices
- opening time
- deadline
- participation threshold
- winner calculation
- tie behavior
- extension behavior
- finalization state

The frontend must not independently determine or persist the authoritative
winner of a group decision.

---

## 47. Venue Vote Eligibility

For the initial Signal-generated venue-selection workflow, eligible voters are
confirmed eligible members of the Signal Group who are permitted to participate
in the applicable decision.

Each eligible member may have at most one active vote in a voting round.

The system must prevent:

- duplicate votes from one voter in one round
- votes from non-members
- votes from ineligible members
- votes for invalid choices
- votes after authoritative finalization

Eligibility must be enforced by the backend/domain security boundary.

---

## 48. Venue Choices

Venue choices participating in a vote must be explicit authoritative records.

A venue choice may originate from an applicable source such as:

- member suggestion
- organic platform suggestion
- platform-curated suggestion
- sponsored suggestion

The source of the venue suggestion must remain distinguishable.

Sponsored placement may cause an eligible venue to be considered or displayed
according to transparent product rules.

Sponsored status must not alter vote counts.

Sponsored status must not silently manufacture a winning outcome.

---

## 49. One Vote Per Member Per Round

Each eligible voter may cast at most one vote in a venue-voting round.

The domain model may permit a voter to change their selection before the
authoritative voting deadline where the applicable decision policy allows it.

If vote changes are permitted, the authoritative state must still represent one
current vote per voter per round.

Concurrent vote writes must not create duplicate authoritative votes.

---

## 50. Abstention

Failure to vote is an abstention.

Abstention is not:

- a No vote
- a vote against the leading venue
- a vote for any venue
- automatic consent

Non-voters must not be silently counted toward any venue's vote total.

Abstention alone must not indefinitely prevent active members from progressing
when the applicable participation threshold has been satisfied.

---

## 51. Initial Venue Participation Threshold

The initial venue-selection policy requires valid participation from at least
50 percent of the currently confirmed eligible voters.

The required number of participating voters is rounded upward where necessary.

Examples:

- 4 eligible confirmed members → at least 2 voters
- 5 eligible confirmed members → at least 3 voters
- 6 eligible confirmed members → at least 3 voters

This threshold is a decision policy and must not be duplicated as unrelated
frontend constants throughout the application.

---

## 52. Primary Venue Vote Deadline

Every venue-voting round has an authoritative backend deadline.

The browser may display a countdown, but the browser countdown is not
authoritative.

When the primary deadline is reached, the domain evaluates:

1. whether the participation threshold was satisfied
2. the valid vote totals
3. whether there is a unique winner
4. whether a tie exists
5. whether the vote requires a final-call extension

Late client state must not override an already finalized authoritative result.

---

## 53. Venue Winner Calculation

When the participation threshold has been satisfied, the venue receiving the
highest number of valid votes wins if it has a unique highest total.

The initial venue-selection policy therefore uses plurality among valid votes.

A venue does not need votes from an absolute majority of every confirmed member
if the participation threshold has been satisfied and the venue has a unique
highest valid vote total.

Example:

With six eligible confirmed members:

- Venue A = 2 votes
- Venue B = 1 vote
- Venue C = 0 votes
- 3 members abstain

Participation = 3 of 6.

The participation threshold is satisfied.

Venue A is the unique plurality winner.

---

## 54. Primary Vote Tie

If the primary venue vote satisfies the participation threshold but two or more
venues share the highest valid vote total, the vote does not immediately
finalize a venue.

SIGNAL opens one short runoff round.

Only the venues tied for the highest vote total participate in the runoff.

The runoff is a new authoritative voting round associated with the same group
decision.

Votes from the original round do not silently become runoff votes.

Eligible members must make a runoff selection if they wish to participate.

---

## 55. Runoff

The runoff has its own:

- opening timestamp
- deadline
- eligible choices
- valid votes
- finalization state

Each eligible voter may cast at most one runoff vote.

Abstention remains abstention.

The runoff is intentionally short for immediate/urgent Signal experiences.

Exact runoff duration belongs to decision policy/configuration and may vary by
activity urgency.

The duration must not be permanently embedded only in frontend code.

---

## 56. Runoff Winner

If the runoff produces a unique highest valid vote total under the applicable
runoff participation rules, that venue wins.

SIGNAL does not create unlimited repeated runoff rounds.

The initial policy permits one runoff round.

If the runoff remains tied after its authoritative deadline, the domain invokes
deterministic SIGNAL tie resolution.

---

## 57. Deterministic SIGNAL Tie Resolution

A second unresolved tie must be resolved deterministically.

The same authoritative inputs must produce the same outcome.

The tie-resolution policy may eventually consider eligible ranking dimensions
such as:

- group proximity
- venue availability/open status
- activity compatibility
- venue eligibility
- applicable platform quality/ranking signals
- other explicit future ranking inputs

The policy must define a stable final fallback so identical ranking values do
not produce random contradictory results.

Sponsored status must not secretly function as the deciding tie-breaker.

Random browser behavior must never determine the authoritative venue.

The exact ranking algorithm is replaceable policy and must not require schema
redesign.

---

## 58. Insufficient Primary Participation

If the primary venue-voting deadline arrives before the participation threshold
has been satisfied, SIGNAL does not pretend that the available votes represent
a valid finalized decision.

Instead, the initial policy opens one short final-call extension.

The extension provides eligible confirmed members one additional opportunity to
participate.

The final-call deadline is authoritative backend/domain time.

---

## 59. Final-Call Extension

The initial venue-selection policy permits at most one final-call extension for
insufficient primary participation.

During the final-call window:

- eligible members may vote according to the applicable policy
- SIGNAL may notify or surface urgency to non-participating eligible members
- the group remains in a pre-lock coordination state
- the venue is not yet finalized merely because one option currently leads

At the final-call deadline, participation is evaluated again.

---

## 60. Insufficient Participation After Final Call

If the applicable participation threshold remains unsatisfied after the
final-call deadline, the system must not silently lower the threshold and
declare a venue winner.

The group enters the applicable inactivity/recovery path.

That path may cause non-participating positions to become eligible for
replacement according to lifecycle and recovery policy.

Any replacement/backfill remains subject to the rule that automatic membership
ends at Plan Lock.

After recovery, a valid decision process may continue or restart according to
explicit domain policy.

---

## 61. Vote Finalization

Vote finalization is an authoritative domain operation.

Finalization must atomically establish the winning outcome so concurrent
requests cannot finalize contradictory venues.

Once a voting round is finalized:

- its authoritative result is immutable except through an explicit future
  correction/admin mechanism
- late votes cannot change the finalized result
- duplicate finalization must not create multiple winners
- Realtime may announce the result but does not create the result

The historical vote record must remain available for appropriate auditing and
analytics.

---

## 62. Venue Selection and Plan Lock

Winning a venue vote selects the venue for the applicable group decision.

Venue selection alone does not necessarily mean that every other requirement
for Plan Lock has been satisfied.

The domain must verify all required Plan Lock conditions before transitioning
the group to locked.

Where venue selection is required, Plan Lock must reference the authoritative
finalized venue outcome rather than a frontend-provided arbitrary winner.

---

## 63. Venue Vote Attribution

Venue voting participates in the venue-attribution funnel.

The system must be capable of distinguishing:

- venue presented
- venue considered/viewed
- venue voted for
- venue selected
- venue associated with a locked Plan
- people directed
- attendance evidence
- estimated or verified economic impact

A vote is not equivalent to venue selection.

Venue selection is not equivalent to attendance.

Attendance is not automatically equivalent to verified spending.

Commercial analytics must preserve these distinctions.

---

## 64. Voting Concurrency Invariants

The initial voting architecture must enforce at least these invariants:

1. One authoritative current vote per eligible voter per round.

2. An ineligible user cannot create a valid vote.

3. A finalized round cannot receive outcome-changing late votes.

4. One voting round cannot have multiple contradictory authoritative winners.

5. Primary tie handling creates at most one runoff under the initial policy.

6. A runoff tie resolves through deterministic backend policy.

7. Failure to vote remains abstention.

8. Insufficient participation does not silently become successful
   finalization.

9. Realtime delivery order does not determine the winner.

10. Sponsored status does not manipulate authoritative vote totals or secretly
    determine a tie.

---

## 65. Initial Venue Decision Path

The initial successful venue-decision path is:

coordination begins
→ eligible venue choices established
→ primary voting opens
→ confirmed eligible members vote or abstain
→ primary deadline
→ participation threshold evaluated

If threshold is satisfied and there is a unique plurality winner:

→ venue finalized

If threshold is satisfied and the highest vote is tied:

→ one runoff
→ runoff deadline
→ unique runoff winner OR deterministic SIGNAL tie resolution
→ venue finalized

If threshold is not satisfied:

→ one final-call extension
→ participation reevaluated

If threshold then becomes satisfied:

→ winner/tie rules execute

If threshold remains unsatisfied:

→ inactivity/recovery path

After authoritative venue finalization:

→ remaining Plan Lock requirements evaluated
→ Plan may lock when all requirements are satisfied.


---

## 66. Availability

SIGNAL uses structured availability as authoritative coordination input.

Availability must resolve to actual time ranges.

Examples of user-facing concepts may include:

- Now
- Tonight
- Tomorrow
- This Weekend
- specific date/time windows

User-facing labels do not replace the underlying authoritative time range.

Availability may distinguish between:

- hard availability
- soft time preference

Hard availability represents a period outside of which the user cannot
participate in the applicable outing.

Soft preference represents a preferred time within otherwise valid
availability.

The matching and coordination system must not silently treat a hard constraint
as a soft preference.

---

## 67. Availability Overlap

SIGNAL should use confirmed-member availability to calculate feasible shared
time windows.

The initial time-coordination strategy should prefer overlap rather than
requiring members to independently invent arbitrary exact times.

A proposed Plan time must be compatible with the applicable hard availability
rules of the members whose participation is required for that proposal.

Availability calculations are domain logic.

The frontend may display calculated overlaps but must not be the sole
authoritative calculator of time compatibility.

---

## 68. Active Core

When the initial coordination threshold of four confirmed eligible members has
been reached, those members establish the initial active coordination core.

The active core provides the participation foundation upon which automatic
pre-lock additions must build.

Seats five and six remain fillable according to the grouping policy.

However, automatic additions must not destabilize the feasible participation
of the active core.

---

## 69. Late Automatic Additions

A user considered for automatic addition after an active core has been
established must remain compatible with the group's applicable coordination
constraints.

For time coordination, the grouping engine must not automatically insert a new
member whose hard availability would require the existing active core to move
outside its feasible window merely to accommodate that new member.

Example:

If the active core has established a feasible evening window around 9:00 PM,
a candidate who can participate only at 10:30 PM must not automatically force
the group to move to 10:30 PM.

That candidate may remain eligible for another compatible Signal Group.

---

## 70. Active Core Protection

Active-core protection applies to automatic matching behavior.

It does not prohibit the confirmed group members themselves from deliberately
changing their coordination decision before Plan Lock.

If the group collectively chooses another valid time through an applicable
decision process, the authoritative group time may change before Plan Lock.

The distinction is:

- automatic matching may not destabilize the active core
- deliberate group decision may change the group's time before Plan Lock

---

## 71. SIGNAL Time Proposal

When one or more feasible shared time windows exist, SIGNAL may calculate and
present a recommended time.

The recommendation should consider applicable authoritative inputs such as:

- hard availability
- number of compatible confirmed members
- soft time preferences
- activity timing
- venue availability where known
- urgency
- other explicit future scheduling policy inputs

The recommendation algorithm is replaceable policy.

The database architecture must not require one permanent scheduling algorithm.

---

## 72. Clear Best-Time Case

When one time option is clearly preferred under the applicable scheduling
policy, SIGNAL may present it as the recommended time.

The product may provide a low-friction action such as:

LOCK 9:00 PM

while still permitting applicable alternative-time exploration before
finalization.

A recommendation is not authoritative Plan time until the applicable
confirmation/finalization operation succeeds.

---

## 73. Multiple Valid Time Options

When multiple meaningful time options remain, SIGNAL may present a constrained
set of valid alternatives rather than requiring arbitrary free-form
coordination.

Displayed alternatives should remain compatible with applicable hard
availability requirements.

Where a group decision is required, time selection may use the authoritative
group-decision framework.

Time voting must not rely solely on frontend state.

---

## 74. Time Decision Participation

Where time requires member voting, the applicable decision policy must define:

- eligible voters
- valid time choices
- participation threshold
- deadline
- winner calculation
- tie handling
- finalization

The general voting framework may be reused where appropriate.

Time-decision policy may differ from venue-decision policy where the domain
requires different behavior.

Any difference must be explicit rather than accidental.

---

## 75. Hard Availability Protection

SIGNAL must not knowingly finalize a proposed time that violates the hard
availability rules required by the applicable Plan Lock policy.

Soft preferences may influence ranking.

Soft preferences must not override hard eligibility/availability constraints.

The backend/domain layer owns authoritative validation.

---

## 76. Time Finalization

Final time selection is an authoritative domain operation.

The selected time must resolve to explicit Plan scheduling data.

Concurrent finalization attempts must not produce contradictory authoritative
Plan times.

Once Plan Lock occurs, the Plan's scheduled time becomes part of the locked
Plan state.

Any later rescheduling must use an explicit future rescheduling workflow rather
than silently mutating the original coordination outcome.

---

## 77. Venue and Time Interaction

Venue and time decisions may affect one another.

A venue must be eligible for the applicable scheduled time where venue
availability information is known and required.

SIGNAL must not knowingly lock a Plan around a venue/time combination that is
invalid under authoritative eligibility information.

The architecture must permit coordination logic to reevaluate eligible venue
choices when the proposed time materially changes.

Similarly, known venue constraints may affect valid time options.

---

## 78. Initial Plan Lock Requirements

For the initial Signal-generated outing workflow, Plan Lock requires at minimum:

1. an originating Signal Group in a valid pre-lock lifecycle state

2. at least four confirmed eligible members

3. an authoritative activity

4. an authoritative scheduled time or applicable finalized activity window

5. an authoritative venue/destination where the activity requires one

6. applicable crowd, age, legal, geographic, and venue eligibility to remain
   valid

7. all required group decisions to be authoritatively finalized

8. no domain condition that currently prohibits locking the Plan

Plan Lock is one controlled backend/domain transition.

The frontend must not construct a supposedly locked Plan through a sequence of
unprotected independent writes.

---

## 79. Automatic Membership Freeze at Lock

Immediately upon successful Plan Lock:

- automatic matching stops
- automatic seat filling stops
- automatic backfill stops
- the confirmed locked membership becomes authoritative Plan membership

Any subsequent admission must use the applicable controlled post-lock admission
workflow.

Plan Lock must therefore establish membership and Plan state consistently
within the authoritative domain boundary.

---

## 80. Time Coordination Invariants

The initial time-coordination architecture must enforce at least:

1. Structured availability resolves to authoritative time ranges.

2. Expired availability cannot continue matching indefinitely.

3. Hard availability is not silently treated as a soft preference.

4. Four confirmed eligible members establish the initial active core.

5. Automatic members five and six must fit applicable active-core constraints.

6. A late automatic addition cannot force the active core into an otherwise
   incompatible time.

7. Confirmed members may deliberately change time before Plan Lock through an
   applicable valid decision process.

8. Time recommendation is not equivalent to authoritative time finalization.

9. Plan Lock requires valid authoritative scheduling data.

10. Realtime does not determine scheduling truth.

11. Concurrent time-finalization attempts cannot create contradictory
    authoritative results.

12. Post-lock time changes require an explicit rescheduling workflow.

---

## 81. Initial Time Coordination Path

The initial successful time-coordination path is:

confirmed active core established
→ authoritative availability evaluated
→ feasible shared windows calculated
→ SIGNAL ranks valid time options

If there is one clearly preferred valid option:

→ SIGNAL proposes the time
→ applicable confirmation/finalization occurs

If multiple meaningful valid options remain:

→ constrained valid options presented
→ applicable group decision occurs
→ time finalizes

While the group remains pre-lock:

→ compatible seats five and six may fill
→ new automatic members must fit applicable active-core constraints

Once venue, time, membership, and all other Plan Lock requirements are valid:

→ Plan Lock executes
→ automatic membership freezes.


---

## 82. Post-Lock Principle

Plan Lock is an authoritative historical transition.

Once a Plan has successfully locked, later real-world changes must not erase
the fact that the Plan previously reached locked state.

A locked Plan does not return to an earlier forming, confirming, or
coordinating lifecycle merely because circumstances change.

Post-lock problems use explicit recovery workflows.

Conceptually:

locked
→ recovery condition
→ recovered locked Plan

or:

locked
→ cancelled

The system must preserve the history of both the original locked outcome and
any later recovery.

---

## 83. Post-Lock Membership Changes

Automatic Signal matching remains disabled after Plan Lock.

A post-lock membership vacancy must not cause the general grouping engine to
silently insert a stranger.

Post-lock membership changes require explicit controlled domain operations.

Applicable operations may include:

- member withdrawal
- controlled admission request
- member-approved admission
- controlled seat reopening
- administrative intervention where authorized

Every post-lock membership change must preserve sufficient historical data to
understand who was originally locked into the Plan and who later entered or
left.

---

## 84. Member Withdrawal After Lock

A locked member may withdraw where withdrawal remains permitted by applicable
Plan policy.

Withdrawal must be an authoritative domain action.

The system must preserve:

- the member's prior Plan membership
- the withdrawal event
- the authoritative withdrawal time
- applicable recovery consequences

Withdrawal must not erase historical membership merely to make the current
member list appear smaller.

---

## 85. Four-or-More Members Remain

If a post-lock withdrawal occurs and at least four eligible participating
members remain, the initial policy allows the Plan to continue without requiring
automatic membership replacement.

The Plan does not automatically fail merely because it falls below its previous
member count.

The remaining group may continue toward the outing.

Where admission remains permitted, an available seat may be filled only through
the applicable controlled post-lock admission workflow.

---

## 86. Membership Falls Below Four

If post-lock participating membership falls below the initial four-person
coordination threshold before the outing begins, SIGNAL must explicitly
recognize a recovery condition.

The initial product policy must not automatically cancel the outing merely
because three members remain.

The remaining eligible members may be offered controlled recovery choices such
as:

- continue with the smaller group where permitted
- reopen an available seat for controlled admission
- cancel the Plan

The decision must be explicit.

The general automatic grouping engine must not silently refill the seat.

---

## 87. Recovery Required

A Plan may enter an explicit recovery-required condition when a material
post-lock problem prevents normal progression.

Recovery-required is not equivalent to returning the Plan to its original
pre-lock lifecycle.

The system must retain:

- the locked Plan identity
- original locked decisions
- original locked membership
- the recovery reason
- recovery actions
- resulting authoritative state

Recovery logic must be testable and backend-authoritative.

---

## 88. Controlled Seat Reopening

Where policy permits, the remaining group may reopen one or more available
post-lock seats.

A reopened seat does not reactivate unrestricted automatic Signal matching.

Admission into the reopened seat uses the controlled post-lock admission
workflow.

That workflow must enforce applicable:

- capacity
- crowd eligibility
- age/legal eligibility
- geographic eligibility
- time compatibility
- authorization
- voting/admission rules

The applicant must not be able to bypass these rules through direct database or
frontend manipulation.

---

## 89. Venue Failure After Lock

A locked venue may later become unusable.

Examples may include:

- venue closure
- unexpected closure
- venue no longer accepting customers
- material venue availability failure
- authoritative platform/admin invalidation
- another supported real-world failure

A venue failure must not silently overwrite the original venue selection.

The Plan enters an applicable venue-recovery condition.

---

## 90. Venue Recovery

During venue recovery, SIGNAL may generate or surface eligible replacement
venues.

Replacement choices must respect applicable:

- activity compatibility
- crowd eligibility
- age/legal requirements
- geographic constraints
- current time constraints
- known venue availability
- other explicit venue policy

Because the Plan may be approaching its start time, venue recovery may use an
accelerated decision policy.

The accelerated policy must still be deterministic and backend-authoritative.

---

## 91. Venue Recovery Finalization

When a replacement venue is selected, the domain must preserve both:

1. the original locked venue
2. the replacement venue and recovery reason

The original historical venue association must not be destroyed by overwriting
the only venue field available to the system.

The recovered venue becomes the current actionable destination.

The historical transition remains available for audit and attribution.

---

## 92. Rescheduling

A locked Plan's scheduled time must not be silently edited.

A requested post-lock time change enters an explicit rescheduling workflow.

Rescheduling must establish:

- who may initiate it
- which members are eligible to participate
- valid replacement times
- applicable deadline
- applicable decision/finalization rule
- effect on current membership
- effect on venue validity
- resulting authoritative Plan schedule

The exact rescheduling policy may vary by Plan type and urgency.

---

## 93. Rescheduling Compatibility

A proposed replacement time must be validated against applicable current Plan
constraints.

Rescheduling may require reevaluation of:

- member hard availability
- venue availability
- age/legal timing requirements
- activity timing
- geographic practicality
- other explicit domain constraints

A reschedule must not silently preserve a venue that is known to be invalid at
the new time.

Likewise, a venue recovery must not silently preserve a time that is known to
be invalid for the replacement venue.

---

## 94. Recovery Urgency

Recovery policy may become more time-sensitive as the outing approaches.

The architecture must support urgency-aware policy without requiring schema
redesign.

For example, a recovery vote occurring hours before an outing may reasonably
have a longer deadline than a venue failure occurring shortly before members
are expected to leave.

Exact urgency windows belong to backend/domain policy.

They must not exist only as scattered frontend timer constants.

---

## 95. Active-Outing Restrictions

Once the Plan has entered active_outing, changes become more restrictive.

The product must distinguish pre-outing recovery from changes attempted while
the real-world outing is already underway.

During active_outing:

- historical attendance context must be protected
- venue attribution must be protected
- arbitrary automatic membership changes remain prohibited
- silent time rewriting is prohibited
- silent venue rewriting is prohibited

Any supported active-outing correction must be an explicit domain event.

---

## 96. Cancellation After Lock

A locked Plan may be cancelled only through an authorized explicit domain
operation.

Cancellation must preserve the historical fact that the Plan previously locked.

Cancellation records should preserve sufficient information to understand:

- when cancellation occurred
- applicable cancellation reason
- who or what initiated cancellation
- membership at cancellation
- venue/time state at cancellation
- applicable attribution state

Cancellation must not delete the Plan merely to represent that the outing did
not occur.

---

## 97. Historical Plan State

SIGNAL must distinguish current actionable Plan state from historical Plan
state.

The architecture must support reconstruction of meaningful transitions such as:

group formed
→ venue A selected
→ Plan locked
→ six members directed toward venue A
→ venue A became unavailable
→ venue recovery opened
→ venue B selected
→ five members continued
→ outing occurred at venue B

The system must not collapse this history into only:

venue = venue B

Doing so would destroy product, operational, and commercial truth.

---

## 98. Venue Attribution Through Recovery

Venue attribution must survive post-lock recovery.

If SIGNAL directs members toward an original venue and later redirects them,
the system must be capable of distinguishing the applicable stages.

Examples include:

- original venue selected
- original venue locked
- members originally directed
- original venue failed
- replacement venue selected
- members redirected
- attendance associated with replacement venue

Commercial reporting must not falsely claim that attendance occurred at the
original venue merely because it was originally selected.

It also must not erase legitimate evidence that SIGNAL initially directed
traffic toward that venue.

---

## 99. Economic Impact Through Recovery

Economic-impact reporting must follow the final applicable attendance and
spending evidence rather than blindly attaching value to the first selected
venue.

If a group is redirected:

- original direction may remain attributable as direction
- replacement direction may remain attributable as redirection
- attendance belongs to the venue supported by attendance evidence
- estimated spending belongs to the applicable attended venue under the
  economic-impact methodology
- verified spending must follow the applicable verification evidence

The system must avoid double-counting one group's economic value across both the
original and replacement venues.

---

## 100. Recovery Event History

Material post-lock changes must be representable as historical domain events or
equivalent authoritative records.

Relevant events may include:

- member withdrew
- seat reopened
- admission requested
- member admitted
- recovery required
- venue became unavailable
- venue recovery opened
- venue replaced
- reschedule requested
- time changed
- Plan cancelled
- outing activated
- Plan completed

The architecture does not require event sourcing for every application write.

It does require enough authoritative history to avoid destructive overwriting
of commercially or operationally meaningful transitions.

---

## 101. Recovery Concurrency

Recovery operations must assume concurrent user activity.

The system must prevent contradictory outcomes such as:

- two applicants receiving the same final available seat
- two replacement venues both becoming authoritative
- conflicting reschedules both finalizing
- cancellation racing with recovery and producing an impossible Plan state
- membership changes exceeding capacity
- a late recovery action mutating a completed Plan

Critical recovery transitions must use controlled backend/database operations
with appropriate concurrency protection.

---

## 102. Recovery and Realtime

Realtime communicates recovery-state changes.

Realtime does not create recovery truth.

A client that misses a recovery event must be able to reload the authoritative
current Plan and sufficient relevant history.

Client event ordering must not determine:

- who owns a reopened seat
- which venue won recovery
- which time finalized
- whether the Plan was cancelled
- whether the Plan completed

---

## 103. Post-Lock Recovery Invariants

The initial architecture must enforce at least:

1. A successfully locked Plan never becomes historically un-locked.

2. Automatic Signal matching never silently resumes after Plan Lock.

3. A post-lock withdrawal does not erase historical membership.

4. Four or more remaining eligible members may continue without automatic
   replacement.

5. Falling below four does not automatically cancel the Plan.

6. Controlled post-lock admission remains subject to eligibility and capacity.

7. Venue recovery preserves the original venue decision.

8. Rescheduling preserves the original locked schedule history.

9. Recovery decisions are backend-authoritative.

10. Realtime does not determine recovery truth.

11. Concurrent recovery actions cannot produce contradictory authoritative
    outcomes.

12. Cancellation preserves historical Plan state.

13. Venue attribution survives redirection without falsely claiming attendance.

14. Economic impact is not double-counted across original and replacement
    venues.

15. Completed Plans cannot be silently returned to an active recovery state.

---

## 104. Initial Post-Lock Recovery Path

The initial post-lock path is:

Plan successfully locks
→ automatic membership freezes

If membership remains valid:

→ Plan proceeds normally

If a member withdraws and four or more remain:

→ Plan continues
→ optional controlled admission may occur where permitted

If membership falls below four:

→ recovery required
→ remaining members may continue smaller where permitted
   OR reopen controlled seat
   OR cancel

If venue fails:

→ venue recovery
→ eligible replacements established
→ accelerated decision where applicable
→ replacement venue finalized
→ redirection history preserved

If time must change:

→ explicit rescheduling workflow
→ constraints reevaluated
→ replacement time finalized where valid

Then:

→ active outing
→ completion

At every stage:

→ original locked history remains preserved
→ attribution remains distinguishable
→ economic impact avoids double counting.


---

## 105. Unified Plan Domain

SIGNAL uses one authoritative Plan domain.

Manual Plans and Signal-generated Plans are not separate application universes.

A Plan must explicitly identify its origin.

Initial origin concepts are:

- manual
- signal

Origin describes how the Plan came into existence.

Origin must not require separate duplicated systems for:

- membership
- eligibility
- venue attribution
- attendance
- notifications
- profiles
- My Plans
- lifecycle history
- cancellation
- completion
- business analytics

Where a Plan originated from a Signal Group, the authoritative relationship to
that originating group must be preserved.

---

## 106. Signal-Generated Plan Origin

A Signal-generated Plan originates from the automatic Signal formation and
coordination lifecycle.

Conceptually:

Signal intent
→ Signal pool
→ Signal Group
→ confirmation
→ coordination
→ venue/time finalization
→ Plan Lock
→ Signal-origin Plan

The originating Signal Group remains historically associated with the resulting
Plan.

A Signal-generated Plan does not require the system to invent a fake human
creator or owner.

Collective group decisions remain authoritative where the applicable policy
requires collective control.

---

## 107. Manual Plan Origin

A Manual Plan originates from an authorized user explicitly creating a Plan.

Conceptually:

creator
→ Create Plan
→ Plan configuration
→ eligibility configuration
→ venue/time configuration
→ publication
→ membership/admission
→ outing
→ completion

Manual creation bypasses automatic Signal group formation.

It does not bypass the authoritative Plan domain.

Manual Plans remain subject to applicable:

- city entitlement
- eligibility
- capacity
- membership
- venue
- time
- attribution
- cancellation
- completion
- security

rules.

---

## 108. Manual Plan Creator

A Manual Plan has an authoritative creator.

The creator is automatically established as an initial Plan participant where
the Plan type and eligibility rules permit creation.

The creator does not need to press Join on their own Plan.

The system must not create duplicate membership if the creator later attempts a
join action.

Creator membership must be established through the controlled Plan-creation
domain operation rather than relying on the frontend to separately insert the
creator afterward.

---

## 109. Creator Eligibility

A user must be eligible for the Manual Plan they create.

A creator cannot create a Plan whose enforced participation rules would make
the creator themselves ineligible unless a future explicit non-participating
organizer Plan type is introduced.

For the initial social Plan model, the creator is a participant.

Examples:

A male participant cannot create himself as a participating member of a
Women Only Plan.

A user who cannot establish required 21+ eligibility cannot create themselves
as a participating member of a 21+ Plan.

Frontend manipulation must not bypass these rules.

---

## 110. Manual Plan Configuration

An authorized Manual Plan creator may configure applicable Plan attributes.

Initial concepts may include:

- activity
- title
- description
- city
- date/time or availability
- venue/destination
- capacity
- crowd eligibility
- age eligibility
- admission mode
- other supported Plan settings

Configuration options remain subject to platform policy.

The frontend must not be able to create arbitrary unsupported domain states
merely because it can submit custom values.

---

## 111. Manual Admission Modes

Manual Plans may support multiple controlled admission modes.

Initial admission-mode concepts are:

- open
- creator_approval
- group_vote

Admission mode determines how an otherwise eligible non-member may become a
Plan member.

Admission mode never overrides mandatory eligibility or capacity rules.

---

## 112. Open Admission

Under open admission, an eligible user may join while valid capacity remains
and all applicable Plan rules permit admission.

Open does not mean unrestricted.

The authoritative join operation must still validate applicable:

- Plan state
- capacity
- crowd eligibility
- age/legal eligibility
- city/access entitlement where applicable
- duplicate membership
- other mandatory restrictions

Concurrent attempts to claim the final available seat must not exceed capacity.

---

## 113. Creator Approval

Under creator_approval, an eligible user requests admission.

The authorized creator may approve or reject the request while the request
remains actionable.

Creator approval cannot override mandatory eligibility.

Creator approval cannot exceed capacity.

The approval operation must revalidate eligibility and capacity at the moment
of authoritative admission.

A request that was eligible when submitted is not guaranteed admission if the
Plan has materially changed before approval.

---

## 114. Group-Vote Admission

Under group_vote, an eligible non-member requests admission and applicable
existing members participate in the controlled admission decision.

The admission workflow may permit appropriate profile inspection before voting.

The voting/finalization rules must be explicit and backend-authoritative.

A successful vote does not permit insertion if mandatory eligibility or
capacity has become invalid before final admission.

Admission finalization and membership insertion must be concurrency-safe.

---

## 115. Signal-Origin Post-Lock Admission

Signal-generated Plans default to collective controlled admission after Plan
Lock where post-lock admission remains permitted.

The initial Signal-origin model does not assign one arbitrary matched member
unilateral ownership over the group.

Where a new person requests admission, the applicable controlled group-admission
workflow governs the result.

Future Plan types may define other explicit governance models without changing
the unified Plan architecture.

---

## 116. Eligibility Overrides Authority

No creator, member vote, sponsored relationship, frontend state, or ordinary
client action may override mandatory Plan eligibility.

Mandatory eligibility wins over admission authority.

Examples include applicable:

- crowd restrictions
- age/legal restrictions
- capacity
- Plan lifecycle state
- platform authorization
- other explicit mandatory rules

Administrative exception mechanisms, if ever introduced, must be explicit,
auditable, and narrowly authorized.

They must not exist as accidental RLS bypasses.

---

## 117. Manual Plan Capacity

Manual Plan capacity is explicit authoritative Plan data.

The platform may define:

- minimum capacity
- maximum capacity
- activity-specific capacity limits
- subscription-specific capacity limits
- other future capacity policy

The initial automatic Signal grouping capacity of six does not automatically
mean every Manual Plan must permanently have a capacity of six.

Manual capacity remains policy-controlled.

The database must prevent authoritative membership from exceeding applicable
capacity under concurrent admissions.

---

## 118. City Entitlement for Manual Plans

Manual Plan creation is subject to city entitlement.

Under the initial standard/free product model, a user may create Plans only
within the city access granted by their applicable account entitlement.

A user must not bypass city restrictions by directly submitting another city
identifier through the frontend or database API.

Future paid/pro entitlements may permit additional city access or creation
according to explicit subscription policy.

City entitlement is authoritative backend/domain policy.

---

## 119. Timeline Visibility

A Manual Plan may become visible on an applicable city timeline when its
publication state and eligibility permit discovery.

Timeline visibility is distinct from admission eligibility.

A user may be able to discover a Plan yet remain unable to join it because of
mandatory participation restrictions.

Likewise, a Plan may exist without being publicly discoverable if its applicable
visibility policy does not permit timeline publication.

Visibility rules must be explicit domain policy.

---

## 120. Manual Venue Selection

A Manual Plan creator may select a venue/destination where the Plan type permits
creator-defined venue selection.

The venue must remain subject to applicable validity and eligibility rules.

Creator venue selection is analytically distinct from a venue selected through
Signal-generated group voting.

The architecture must preserve venue-selection origin.

Initial venue-selection origin concepts may include:

- creator_selected
- group_voted
- signal_recommended
- recovered/replacement selection
- other explicit future sources

---

## 121. Manual Plan Venue Attribution

Manual Plans participate in venue attribution.

If SIGNAL facilitates a Manual Plan that directs members toward a venue, that
traffic may be included in applicable platform impact analytics.

However, reporting must remain capable of distinguishing traffic arising from:

- Signal-generated recommendation/coordination
- Manual user-created Plans
- sponsored venue exposure
- other future attribution channels

The platform must not falsely imply that SIGNAL algorithmically selected a venue
when a Manual Plan creator selected it.

---

## 122. Manual Plan Economic Impact

Manual Plans may contribute to economic-impact estimation when applicable
members are directed toward or attend a venue.

The same distinction between:

- estimated directed value
- estimated attendance value
- verified spending

continues to apply.

Plan origin and venue-selection origin must remain available as attribution
dimensions.

Economic value must not be double-counted merely because the Plan participates
in multiple attribution categories.

---

## 123. My Plans

My Plans should operate across the unified Plan domain.

A user's relevant Plans may include applicable relationships such as:

- Manual Plans they created
- Plans they joined
- Signal-generated Plans in which they participate
- completed Plans
- cancelled Plans where historical visibility is appropriate

The product should not require completely separate user experiences merely
because one Plan originated manually and another originated from Signal.

Origin may be displayed or used for filtering where useful.

---

## 124. Plan Ownership vs Governance

Creator identity and Plan governance are distinct concepts.

A Manual Plan may have a creator with defined creator permissions.

A Signal-generated Plan may have no human creator.

Governance rules determine who may perform actions such as:

- approve admission
- initiate cancellation
- initiate rescheduling
- initiate venue recovery
- modify permitted Plan details
- perform other controlled actions

The schema must not assume that every Plan action requires one universal
owner_id.

This avoids fake ownership for collectively generated Signal Plans.

---

## 125. Plan Creation Atomicity

Manual Plan creation must be a controlled backend/domain operation.

Where creation requires:

- Plan record
- creator relationship
- creator membership
- eligibility configuration
- initial venue/time state
- publication state
- other required initial state

those records must be established consistently.

A partial failure must not leave a publicly actionable Plan with missing
required authoritative relationships.

---

## 126. Manual Plan Editing

Before applicable lock/publication boundaries, creators may edit fields that
policy permits.

Editing must respect domain validation.

Material changes may require reevaluation of:

- current member eligibility
- venue validity
- time compatibility
- capacity
- admission requests
- timeline visibility
- attribution

The product must not permit a creator to change a Plan from one eligibility
model to another while silently retaining members who no longer qualify.

Material-edit policy must be explicit before implementation.

---

## 127. Manual and Signal Plan Security

Both Plan origins use the same security doctrine:

- frontend state is untrusted
- RLS is mandatory
- domain transitions are authoritative
- privileged operations use narrow controlled functions where required
- direct client writes cannot bypass eligibility
- direct client writes cannot exceed capacity
- direct client writes cannot fabricate membership
- direct client writes cannot fabricate venue attribution
- direct client writes cannot fabricate attendance or economic impact

Origin does not weaken the security boundary.

---

## 128. Unified Plan Invariants

The initial unified Plan architecture must enforce at least:

1. Every Plan has an explicit valid origin.

2. Signal-origin Plans preserve their originating Signal Group relationship.

3. Manual Plans preserve their creator relationship.

4. A Manual Plan creator is automatically a participant under the initial
   social Plan model.

5. Creator membership cannot duplicate.

6. Creator authority cannot override mandatory eligibility.

7. Admission mode cannot override mandatory eligibility.

8. Membership cannot exceed authoritative capacity.

9. Free/standard users cannot bypass city entitlement through direct writes.

10. Signal-generated Plans do not require fake human ownership.

11. Manual and Signal Plans use the same authoritative membership domain.

12. Both origins participate in venue attribution where applicable.

13. Attribution preserves Plan origin and venue-selection origin.

14. Estimated economic impact remains distinguishable from verified spending.

15. Concurrent creation/admission cannot produce contradictory authoritative
    membership or capacity state.

---

## 129. Initial Manual Plan Path

The initial Manual Plan path is:

authorized user chooses Create Plan
→ creator configures activity
→ city entitlement validated
→ creator eligibility validated
→ crowd/age rules established
→ venue/time established where applicable
→ capacity established
→ admission mode established
→ controlled Plan creation
→ creator membership established atomically

Then, according to publication/admission policy:

→ Plan becomes discoverable where permitted

If admission mode = open:

→ eligible users may join until capacity

If admission mode = creator_approval:

→ eligible user requests
→ creator approves/rejects
→ eligibility/capacity revalidated
→ membership inserted if valid

If admission mode = group_vote:

→ eligible user requests
→ controlled member vote
→ eligibility/capacity revalidated
→ membership inserted if valid

Then:

→ outing lifecycle
→ venue attribution
→ attendance/economic attribution where applicable
→ completion/cancellation history preserved.

---

## 130. Initial Unified Plan Model

Conceptually:

SIGNAL ORIGIN

Signal Intent
→ Signal Pool
→ Signal Group
→ Coordination
→ Plan Lock
        \
         → PLAN
        /
MANUAL ORIGIN

Creator
→ Create Plan
→ Configuration
→ Publication

The resulting Plan domain then supports shared:

- membership
- eligibility
- venue
- scheduling
- admission
- recovery
- attendance
- attribution
- economic impact
- completion
- history

without duplicating the product into separate Plan systems.


---

## 131. Plan Edit Governance

Plan editing is governed by domain policy.

A Plan creator does not receive unrestricted authority to mutate any Plan field
at any time.

The system distinguishes between:

- safe edits
- material edits

The applicable rules may become more restrictive as:

- members join
- admission requests exist
- decisions finalize
- the Plan locks
- the outing approaches
- the outing becomes active
- the Plan completes or is cancelled

Creator authority remains subordinate to mandatory domain invariants.

---

## 132. Safe Edits

Safe edits are changes that do not materially alter what participants agreed to
join and do not invalidate eligibility, membership, capacity, venue, schedule,
or other authoritative Plan rules.

Examples may include applicable:

- typo correction
- non-material description correction
- permitted presentation metadata
- other explicitly classified non-material fields

Safe edits may use a lower-friction update path where policy permits.

A field must not be treated as safe merely because the frontend presents it as
simple text.

The backend/domain policy determines whether an edit is safe.

---

## 133. Material Edits

A material edit is a change capable of affecting:

- member eligibility
- participation expectations
- capacity
- admission
- venue
- scheduling
- visibility
- attribution
- Plan governance
- another meaningful domain condition

Examples include:

- crowd eligibility changes
- age eligibility changes
- venue changes
- significant time changes
- capacity changes
- admission-mode changes
- city changes
- other participation-affecting changes

Material edits require controlled domain validation.

They must not be implemented as unrestricted direct client updates.

---

## 134. Editing Before Other Members Join

Before another participant has joined or materially relied upon the Plan,
the creator may have broader editing authority within platform policy.

Even during this phase:

- creator eligibility must remain valid
- city entitlement must remain valid
- capacity must remain valid
- mandatory platform restrictions still apply
- invalid domain states remain prohibited

Broad creator editing does not mean unrestricted database mutation.

---

## 135. Editing After Members Join

Once other members have joined, material Plan changes become more restrictive.

The system must consider the existing members and commitments before allowing
the change.

A creator must not silently transform a Plan into something materially
different while retaining participants as though they had agreed to the new
conditions.

Material changes may require:

- rejection
- revalidation
- member consent
- a specialized recovery workflow
- rescheduling
- venue recovery/change workflow
- other explicit domain handling

depending on the type of change.

---

## 136. Crowd Eligibility Changes

A crowd-eligibility change must revalidate current membership.

A creator must not silently change crowd rules in a way that causes existing
members to become ineligible while leaving those members attached as valid
participants.

Examples include changes between applicable modes such as:

- Everyone
- Women Only
- Men Only

If a requested crowd-rule change conflicts with existing membership, the
operation must be rejected or handled through an explicit future transition
policy.

The initial implementation should prefer rejection over silently removing
existing members.

---

## 137. Age Eligibility Changes

An age-eligibility change must revalidate current membership.

A creator must not silently establish a new age restriction that invalidates
existing members while retaining them as valid participants.

The initial implementation should reject a requested age-rule change that would
make existing authoritative members ineligible.

Raw birthday remains private.

Eligibility validation uses authoritative age/eligibility information rather
than trusting client-supplied age.

---

## 138. Capacity Increases

A creator may request a capacity increase where:

- Plan policy permits it
- applicable product/subscription limits permit it
- activity constraints permit it
- other domain restrictions remain valid

A capacity increase does not automatically admit additional people.

Normal admission rules continue to apply.

---

## 139. Capacity Reductions

A Plan's capacity must never be reduced below its current authoritative
membership count.

The system must reject such a request.

A capacity reduction must also consider applicable pending or finalized
admission state according to explicit policy.

Reducing capacity must not be used as an indirect mechanism for silently
removing existing members.

---

## 140. Venue Changes Before Commitment

Before other members have materially committed and before applicable lock
boundaries, a Manual Plan creator may have broader ability to change the venue
where domain policy permits.

The replacement venue must still satisfy applicable:

- activity compatibility
- age/legal eligibility
- geographic rules
- timing
- platform validity
- other venue constraints

Venue-selection history should remain sufficient for attribution where
commercially meaningful activity has already occurred.

---

## 141. Venue Changes After Commitment

Once other members have joined or the Plan has crossed an applicable commitment
boundary, a material venue change must not occur as a silent creator edit.

The change must use an applicable controlled venue-change or venue-recovery
workflow.

That workflow must preserve:

- prior venue state
- reason for change where applicable
- replacement venue
- member decision/consent where required
- attribution history

A creator cannot overwrite historical venue truth merely because they created
the Plan.

---

## 142. Time Changes Before Commitment

Before other members have materially committed and before applicable lock
boundaries, a creator may have broader ability to modify Plan scheduling where
domain policy permits.

The resulting schedule must remain valid under applicable Plan constraints.

---

## 143. Time Changes After Commitment

Once other members have joined or the Plan has crossed an applicable commitment
boundary, a material time change must use the explicit rescheduling workflow.

The creator may be permitted to initiate rescheduling.

The creator does not unilaterally bypass:

- member availability
- applicable voting/consent
- venue validity
- scheduling constraints
- other domain rules

Original schedule history must remain preserved.

---

## 144. Admission-Mode Changes

Admission mode is material Plan configuration.

A creator may not change admission mode in a manner that silently invalidates,
bypasses, or improperly finalizes existing admission requests or decisions.

Before changing admission mode, the domain must evaluate applicable:

- pending requests
- active admission votes
- approvals
- available capacity
- membership
- Plan lifecycle state

Where a safe deterministic transition is unavailable, the change must be
rejected rather than leaving contradictory admission state.

---

## 145. City Changes

City is a material Plan attribute.

A published or joined Plan must not be casually moved from one city timeline to
another through an ordinary edit.

A city change may affect:

- entitlement
- timeline visibility
- geographic eligibility
- venue validity
- current membership
- discovery
- attribution

The initial implementation should prohibit city changes after meaningful Plan
commitment.

Where city correction is needed before commitment, entitlement and all
applicable domain rules must be revalidated.

---

## 146. Member Revalidation

Any material edit capable of affecting eligibility must revalidate applicable
current members before finalization.

A material edit must not succeed first and leave member cleanup to a later
frontend process.

The authoritative operation must either:

- establish a valid resulting state

or:

- reject the requested change

unless an explicit controlled transition policy defines another safe outcome.

---

## 147. Existing Commitment Protection

SIGNAL protects existing participant commitment.

Once users have joined a Plan based on defined conditions, a creator cannot
silently rewrite those conditions in a way that materially changes the outing.

This principle applies especially to:

- crowd composition
- age eligibility
- venue
- time
- city
- capacity
- admission governance

The degree of required consent may vary by change type and lifecycle state.

The requirement for controlled handling does not.

---

## 148. Creator-Initiated Cancellation

For a Manual Plan, the creator may be authorized to initiate cancellation.

Initiation does not mean destructive deletion.

The cancellation request must pass applicable domain authorization and lifecycle
rules.

Once cancellation succeeds, the Plan becomes authoritatively cancelled and its
historical state remains preserved.

---

## 149. Manual Plan Cancellation History

Cancellation of a Manual Plan must preserve sufficient historical information
to understand the Plan that had existed.

Applicable history may include:

- creator
- members
- venue
- schedule
- eligibility
- admission mode
- cancellation time
- cancellation reason where applicable
- cancellation initiator
- venue attribution already generated
- other commercially or operationally meaningful state

Cancellation must not be represented by deleting the Plan.

---

## 150. Cancellation Notifications

When a Plan with other participating members is cancelled, affected members
must be eligible to receive an authoritative cancellation notification through
the applicable notification system.

Notification delivery is not the source of cancellation truth.

If a user misses the notification, reloading the Plan must still reveal the
authoritative cancelled state.

---

## 151. Signal-Origin Cancellation Governance

Signal-generated Plans have no fake unilateral human owner.

Cancellation governance for a Signal-origin Plan must therefore use explicit
collective/system policy.

Applicable future policy may permit:

- member-initiated cancellation proposal
- group decision
- automatic system cancellation under defined conditions
- authorized administrative intervention

One arbitrary matched member must not receive creator-like cancellation power
merely because a schema requires an owner.

---

## 152. Creator Authority Boundary

For Manual Plans, the creator may receive elevated governance permissions.

Those permissions exist inside the Plan domain.

They do not supersede:

- mandatory eligibility
- capacity
- lifecycle state
- city entitlement
- concurrency protection
- historical preservation
- platform authorization
- other explicit invariants

The governing principle is:

Creator may initiate or control permitted actions.

The authoritative domain decides whether those actions are valid.

---

## 153. No Destructive Historical Editing

Material Plan history must not be rewritten merely to make the current Plan
record look simple.

Where commercially or operationally meaningful, SIGNAL must preserve changes
such as:

- original venue and replacement venue
- original time and rescheduled time
- original eligibility configuration and permitted transition
- original membership and later withdrawal
- original capacity and later valid capacity change
- cancellation after prior commitment

The architecture does not require full event sourcing.

It does require enough durable history to reconstruct meaningful Plan
transitions.

---

## 154. Edit Concurrency

Plan editing must assume concurrent activity.

The architecture must prevent outcomes such as:

- capacity reduced while another member is simultaneously admitted, resulting
  in over-capacity or invalid state
- eligibility changed while an incompatible admission finalizes
- venue replaced by two conflicting operations
- two reschedules both becoming authoritative
- cancellation racing with an edit and leaving the Plan simultaneously active
  and cancelled
- a late edit mutating a completed Plan

Critical material transitions require controlled database/backend operations
with appropriate concurrency protection.

---

## 155. Completed and Cancelled Plan Editing

Completed and cancelled Plans are historical records.

Ordinary creators and members must not return them to active state through
normal editing.

Any future correction mechanism must be explicit, narrowly authorized, and
auditable.

Historical correction must remain distinguishable from ordinary Plan
participation/editing.

---

## 156. Edit and Cancellation Invariants

The initial architecture must enforce at least:

1. Safe and material edits are domain concepts, not frontend-only labels.

2. Material edits after member commitment require controlled validation.

3. Crowd-rule changes cannot silently leave ineligible members attached.

4. Age-rule changes cannot silently leave ineligible members attached.

5. Capacity cannot be reduced below authoritative membership.

6. Capacity changes cannot bypass admission rules.

7. Material venue changes after commitment use controlled venue handling.

8. Material time changes after commitment use rescheduling.

9. Admission-mode changes cannot invalidate active admission state silently.

10. City changes cannot bypass city entitlement.

11. Material edits revalidate affected authoritative state before succeeding.

12. Creator authority cannot override mandatory domain rules.

13. Cancellation preserves Plan history.

14. Signal-origin Plans do not receive fake unilateral cancellation ownership.

15. Concurrent edits cannot create contradictory authoritative Plan state.

16. Completed or cancelled Plans cannot be silently reactivated.

---

## 157. Initial Manual Plan Edit Path

The initial edit path is:

creator requests edit
→ creator authorization validated
→ Plan lifecycle evaluated
→ requested field classified under domain policy

If safe edit:

→ validate permitted value
→ authoritative update

If material edit:

→ determine affected domain rules
→ revalidate membership/eligibility/capacity/venue/time/admission as applicable

If resulting state would violate an invariant:

→ reject edit

If specialized workflow is required:

→ route to controlled workflow
   such as venue change, rescheduling, or another explicit transition

If resulting state is valid:

→ finalize authoritative change
→ preserve required historical transition
→ publish Realtime/notification effects after truth exists

Cancellation follows:

creator or authorized governance initiates
→ authorization/lifecycle validation
→ authoritative cancellation
→ historical Plan preserved
→ affected members notified.


---

## 158. I'M BORED Discovery Mode

SIGNAL supports an I'M BORED discovery mode.

I'M BORED exists for users who have social intent but have not yet decided
exactly what they want to do.

It is a progressive intent-discovery experience.

It is not:

- a separate social network
- a separate matching engine
- merely a venue recommendation list
- merely an event-search page
- a long onboarding questionnaire

Its purpose is to convert uncertainty into structured Signal intent with as
little friction as practical.

Conceptually:

I'M BORED
→ progressive discovery
→ structured activity/vibe/time intent
→ compatible Signal pool
→ existing Signal matching
→ group formation
→ coordination
→ Plan Lock
→ real-world outing

---

## 159. Progressive Discovery Experience

I'M BORED should feel fast, playful, premium, and low-commitment.

The user should be able to progressively express interest through lightweight
interactions such as:

- taps
- cards
- swipes
- quick choices
- skip/pass actions
- Surprise Me
- other future low-friction interactions

The experience should not require the user to complete a large form before
receiving useful discovery feedback.

Each meaningful interaction may contribute structured preference or intent data
according to explicit domain policy.

Presentation mechanics may differ between desktop and mobile while preserving
the same underlying intent model.

---

## 160. Discovery Dimensions

I'M BORED may progressively discover applicable dimensions such as:

- activity
- activity category
- vibe
- timing
- immediacy
- venue/category preference
- indoor/outdoor preference
- neighborhood or proximity preference
- other future discovery dimensions

Examples of user-facing discovery choices may include concepts such as:

- Drinks
- Food
- Live Music
- Bowling
- Karaoke
- Something Outside
- Something Fun
- Somewhere New
- Chill
- Lively
- Tonight
- Right Now
- Surprise Me

These examples are product presentation concepts.

They must not require the database to hard-code one permanent set of cards or
questions.

---

## 161. Structured Intent Output

The output of I'M BORED discovery must become structured domain intent rather
than remaining only ephemeral frontend selections.

When sufficient information exists to participate in matching, the discovered
intent may create or contribute to authoritative Signal intent.

The intent may include applicable dimensions already defined by the Signal
domain, including:

- city
- activity
- time window
- crowd eligibility
- age/legal eligibility
- proximity
- other applicable compatibility dimensions

I'M BORED must feed the existing Signal architecture rather than creating a
parallel matching architecture.

---

## 162. Progressive Intent Confidence

SIGNAL does not need to know every possible preference before providing value.

The discovery system may progressively increase confidence about what the user
is interested in.

The system may begin surfacing meaningful social opportunities as soon as
sufficient compatible intent exists.

Future recommendation policy may use:

- explicit positive selections
- explicit passes
- repeated preference patterns
- current context
- applicable historical preference signals
- other authorized recommendation inputs

The recommendation policy is replaceable.

The core database must not require one permanent recommendation algorithm.

---

## 163. Social Opportunity Reveal

The defining outcome of I'M BORED is not merely recommending an activity.

When compatible active Signal intent exists, SIGNAL should be capable of
revealing the social opportunity.

Conceptually:

5 compatible people are interested in Live Music + Drinks tonight.

The product may surface an experience such as:

5 people are feeling this tonight.

Join the Signal.

The exact copy and presentation are frontend product decisions.

The underlying compatibility and participant counts must come from
authoritative domain data rather than fabricated UI numbers.

---

## 164. Existing Signal Engine Reuse

Once I'M BORED produces sufficient structured intent, the existing Signal
engine takes over.

I'M BORED therefore inherits applicable rules for:

- city pooling
- time compatibility
- crowd eligibility
- age/legal eligibility
- proximity
- Signal expiration
- scalable Signal pools
- multiple group formation
- activation threshold
- group capacity
- confirmation
- active-core protection
- coordination
- venue selection
- time selection
- Plan Lock
- recovery
- completion

If 100 compatible users independently discover the same intent through I'M
BORED, the architecture must remain capable of forming multiple appropriately
sized groups rather than one giant group.

---

## 165. Eligibility During Discovery

Discovery and participation eligibility are distinct.

SIGNAL may surface broad discovery possibilities while still enforcing
mandatory eligibility before authoritative participation.

A user must not enter an ineligible Signal Group merely because I'M BORED
surfaced an activity.

Applicable restrictions may include:

- city entitlement
- crowd eligibility
- age/legal eligibility
- venue restrictions
- time compatibility
- capacity
- other mandatory Signal rules

Eligibility remains backend/domain-authoritative.

---

## 166. Discovery Expiration

I'M BORED-derived intent is time-sensitive.

Intent such as:

- Right Now
- Tonight
- This Weekend

must resolve to authoritative time windows and expiration.

A discovery interaction from an earlier session must not indefinitely remain
active and accidentally match the user into a future outing after the relevant
intent has expired.

Expiration follows the existing Signal intent doctrine.

---

## 167. I'M BORED and Venue Recommendations

I'M BORED may surface venue or venue-category possibilities as part of
progressive discovery.

Venue recommendation does not itself equal:

- a vote
- venue selection
- Plan Lock
- attendance
- verified spending

If the resulting Signal Group later coordinates around a venue, the normal
authoritative venue-decision and attribution rules apply.

---

## 168. I'M BORED Attribution Origin

SIGNAL must be capable of identifying that a Signal intent or resulting journey
originated through I'M BORED where commercially or analytically relevant.

Conceptually, acquisition/journey origin may distinguish experiences such as:

- direct Signal intent
- I'M BORED discovery
- Manual Plan
- other future product entry paths

This origin must not require separate Plan or Signal systems.

It is an attribution dimension.

---

## 169. Venue Impact From I'M BORED

Real-world venue traffic originating through I'M BORED participates in the
existing venue-attribution framework.

The system should eventually be capable of measuring funnels such as:

I'M BORED interaction
→ activity discovery
→ Signal intent
→ group formation
→ venue considered
→ venue selected
→ Plan locked
→ people directed
→ attendance evidence
→ economic-impact estimate

These stages must remain distinguishable.

A discovery impression is not equivalent to a person directed.

A person directed is not automatically equivalent to attendance.

Attendance is not automatically equivalent to verified spending.

---

## 170. Sponsored Discovery

Future sponsored venue or activity discovery may participate in I'M BORED.

Sponsored content must remain explicitly distinguishable from organic
discovery/recommendation.

Sponsorship may affect eligible presentation according to transparent platform
policy.

Sponsorship must not:

- fabricate compatible users
- fabricate Signal activity
- fabricate votes
- fabricate attendance
- fabricate spending
- bypass mandatory eligibility
- secretly determine a voting tie

Sponsored discovery must remain measurable independently from organic
discovery.

---

## 171. Discovery Privacy

I'M BORED must not require exposing another user's exact location or private
profile data merely to create social momentum.

The product may surface aggregate opportunity information where permitted, such
as an applicable compatible-user count.

Aggregate discovery surfaces must respect privacy and applicable minimum-group
or anti-inference policy.

The architecture must permit future safeguards against exposing sensitive
information through overly granular counts.

---

## 172. Discovery History

The system may preserve meaningful I'M BORED journey history for applicable:

- recommendation improvement
- analytics
- conversion measurement
- attribution
- product optimization

Historical discovery data must remain distinguishable from currently active
Signal intent.

A past tap must not automatically mean the user currently intends to
participate.

Active intent requires applicable authoritative state and expiration.

---

## 173. I'M BORED Product Principle

The core product principle is:

The user should be able to begin with:

"I'm bored."

and, through a small number of lightweight discovery interactions, reach:

"There are compatible people who want to do this."

and ultimately:

"We have a real Plan."

SIGNAL performs the organizational work between those states.

The user should not need to arrive with a fully formed event idea before the
platform can help create real-world social activity.

---

## 174. I'M BORED Invariants

The initial architecture must enforce at least:

1. I'M BORED is a discovery mode, not a separate matching engine.

2. Discovery output may become structured Signal intent.

3. Active intent remains authoritative backend/domain state.

4. Time-sensitive discovered intent expires.

5. Existing Signal eligibility rules remain enforceable.

6. Compatible-user counts must reflect authoritative data.

7. Large compatible pools remain capable of producing multiple groups.

8. Discovery does not bypass Signal confirmation or Plan Lock.

9. Discovery-origin attribution remains distinguishable where applicable.

10. Venue discovery is not equivalent to venue selection.

11. Venue selection is not equivalent to attendance.

12. Estimated economic impact is not represented as verified spending.

13. Sponsored discovery remains distinguishable from organic discovery.

14. Sponsorship cannot fabricate social proof or bypass eligibility.

15. Historical discovery behavior is distinct from current active intent.

---

## 175. Initial I'M BORED Path

The initial conceptual path is:

user selects I'M BORED
→ progressive discovery begins
→ user expresses lightweight preferences
→ SIGNAL derives structured activity/vibe/time intent
→ city and mandatory eligibility context applied
→ compatible active opportunity evaluated

If insufficient matching information exists:

→ continue lightweight discovery

If sufficient structured intent exists:

→ authoritative Signal intent may activate
→ compatible Signal pool evaluated

If compatible social opportunity exists:

→ social opportunity revealed
→ user proceeds into existing Signal experience

Then:

→ matching
→ group formation
→ confirmation
→ coordination
→ venue/time finalization
→ Plan Lock
→ outing
→ completion

Throughout the journey:

→ discovery origin remains measurable
→ venue attribution remains truthful
→ economic-impact stages remain distinguishable
→ the existing Signal domain remains authoritative.
