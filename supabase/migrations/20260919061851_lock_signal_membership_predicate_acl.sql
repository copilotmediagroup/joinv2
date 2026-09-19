begin;

-- These round-membership helpers are policy/internal predicates, not browser
-- RPC entry points. They derive caller identity through is_signal_group_member
-- and remain available to privileged database execution only.
revoke all
on function public.is_signal_time_round_member(uuid)
from public, anon, authenticated;

grant execute
on function public.is_signal_time_round_member(uuid)
to service_role;

revoke all
on function public.is_signal_venue_round_member(uuid)
from public, anon, authenticated;

grant execute
on function public.is_signal_venue_round_member(uuid)
to service_role;

comment on function public.is_signal_time_round_member(uuid)
is 'Internal membership predicate for Signal time-round policy/authority checks. Browser execution is revoked.';

comment on function public.is_signal_venue_round_member(uuid)
is 'Internal membership predicate for Signal venue-round policy/authority checks. Browser execution is revoked.';

commit;
