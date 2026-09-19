begin;

-- 20260915015718_deterministic_coordination_fallback.sql redefined the
-- internal time reconciler and accidentally restored authenticated EXECUTE.
-- Browser callers already use reconcile_my_signal_time_round(uuid), which
-- verifies Signal membership before delegating here.
revoke all
on function public.reconcile_signal_time_round(uuid)
from public, anon, authenticated;

grant execute
on function public.reconcile_signal_time_round(uuid)
to service_role;

comment on function public.reconcile_signal_time_round(uuid)
is 'Internal Signal time-round reconciler. Browser callers must use reconcile_my_signal_time_round(uuid), which enforces membership.';

commit;
