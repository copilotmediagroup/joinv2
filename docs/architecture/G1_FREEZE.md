# SIGNAL — G1 Product Contract Freeze

Status: FROZEN

The SIGNAL G1 product/domain contract is frozen as the authoritative baseline
for G2 database architecture.

The frozen contract contains 175 numbered product/domain sections.

G1 defines the product behavior and invariants.

G2 must derive database architecture from G1.

G2 must not redesign product behavior merely because another schema would be
easier to implement.

If implementation reveals a genuine contradiction, missing invariant, or
unsafe domain condition:

STOP.

Do not patch around it.

Explicitly amend the product contract first.

## Engineering Doctrine

No patch chains.

No guessing at production schema.

No fake owners.

No frontend business logic that belongs in PostgreSQL.

No "we'll clean it up later."

No changing five things before verifying the first thing.

## Development Gates

Architecture
→ migration
→ database verification
→ concurrency/failure tests
→ backend domain layer
→ Realtime
→ frontend
→ browser verification
→ checkpoint

## G2 Rule

G2 begins with a database blueprint.

Do not begin by dumping a giant SQL migration into Supabase.

First derive:

- entities
- relationships
- ownership/governance
- authoritative state
- lifecycle state
- constraints
- immutable/history records
- concurrency boundaries
- RLS boundaries
- controlled PostgreSQL operations
- indexes
- Realtime publication requirements

Only after the blueprint is reviewed and locked may migration 0001 be written.
