begin;

-- SIGNAL Migration 0049: scale the exact automatic-admission lookup.
-- The hot path searches only FORMING groups and orders compatible
-- candidates by formed_at/id before taking and locking one row.

create index if not exists signal_groups_forming_compatibility_idx
  on public.signal_groups(
    city_id,
    activity_id,
    grouping_policy_id,
    crowd_mode,
    starts_at,
    ends_at,
    formed_at,
    id
  )
  include (vibe_id,min_age,max_age,expires_at)
  where state = 'forming'::public.signal_group_state;

commit;
