begin;

revoke execute
on function public.get_my_active_signal_resume()
from authenticated;

comment on function public.get_my_active_signal_resume()
is 'Legacy Signal-only resume RPC retained for migration history; browser callers must use get_my_active_signal_journey_resume().';

commit;
