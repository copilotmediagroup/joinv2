begin;

revoke execute on function public.report_user(uuid,text,text)
from authenticated;

revoke execute on function public.propose_plan_change(uuid,text,uuid,timestamptz)
from authenticated;

revoke execute on function public.enforce_user_account(uuid,text,integer,text,uuid)
from authenticated;

revoke execute on function public.lift_user_account_restriction(uuid,text)
from authenticated;

revoke execute on function public.enforce_moment_author_account(uuid,text,integer,text)
from authenticated;

comment on function public.report_user(uuid,text,text)
is 'Retired legacy entry point. Browser access revoked; use report_user_v2.';

comment on function public.propose_plan_change(uuid,text,uuid,timestamptz)
is 'Retired legacy entry point. Browser access revoked; use propose_plan_change_v2.';
comment on function public.enforce_user_account(uuid,text,integer,text,uuid)
is 'Retired legacy entry point. Browser access revoked; use enforce_user_account_v2.';

comment on function public.lift_user_account_restriction(uuid,text)
is 'Retired legacy entry point. Browser access revoked; use lift_user_account_restriction_v2.';

comment on function public.enforce_moment_author_account(uuid,text,integer,text)
is 'Retired legacy entry point. Browser access revoked; use enforce_moment_author_account_v2.';

commit;
