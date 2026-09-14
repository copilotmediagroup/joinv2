begin;

revoke execute
on function public.reconcile_signal_time_round(uuid)
from authenticated;

comment on function public.reconcile_signal_time_round(uuid)
is 'Internal Signal time-round reconciler. Browser callers must use reconcile_my_signal_time_round(uuid), which enforces membership.';

commit;
