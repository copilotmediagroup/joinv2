# SIGNAL — G2 Database Blueprint Freeze

Status: FROZEN

The SIGNAL database architecture blueprint is frozen as the authoritative
baseline for physical PostgreSQL/Supabase implementation.

G2 defines:

- domain boundaries
- entity inventory
- relationship map
- authority ownership
- current-state vs history doctrine
- Signal Pool as derived V1 concept
- Signal Group and Plan separation
- Signal Group Membership and Plan Membership separation
- unified Plan domain
- invariants
- concurrency boundaries
- idempotency doctrine
- transaction doctrine
- lifecycle protection
- failure-test matrix
- RLS doctrine
- read/write boundaries
- controlled user operations
- system operations
- administrative operations
- Storage security boundary
- Realtime security boundary
- least-privilege doctrine

## Implementation Rule

G3 must implement the frozen G1 product contract and frozen G2 database
blueprint.

G3 must not silently alter architecture merely because a different schema is
easier to write.

If physical design reveals a contradiction:

STOP.

Do not patch around it.

Explicitly amend G1/G2 first.

## G3 Gate Order

Physical schema design
→ migration
→ database verification
→ concurrency/failure tests
→ RLS tests
→ controlled operations
→ backend domain integration
→ Realtime
→ frontend
→ browser verification
→ checkpoint

## Migration Doctrine

Migration 0001 must establish a coherent greenfield foundation.

Do not create a giant speculative schema containing every future feature.

Implement the authoritative core and supporting structures required by the
frozen architecture.

Every physical table must have:

- purpose
- authority classification
- keys
- relationships
- constraints
- access model
- history implications
- index/query justification

Critical state transitions must not become arbitrary frontend write chains.
