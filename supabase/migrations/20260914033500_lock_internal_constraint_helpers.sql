begin;

revoke all on function public.enforce_signal_group_time_window()
from public,anon,authenticated;
grant execute on function public.enforce_signal_group_time_window()
to service_role;

revoke all on function public.is_valid_timezone_name(text)
from public,anon,authenticated;
grant execute on function public.is_valid_timezone_name(text)
to service_role;

comment on function public.enforce_signal_group_time_window()
is 'Internal signal_groups trigger helper. Browser execution is intentionally revoked.';

comment on function public.is_valid_timezone_name(text)
is 'Internal cities constraint helper. Browser execution is intentionally revoked.';

commit;
