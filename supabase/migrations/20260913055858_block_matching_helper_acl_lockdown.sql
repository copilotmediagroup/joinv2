begin;

revoke execute
on function public.is_my_signal_group_block_compatible(uuid,uuid)
from authenticated;

commit;
