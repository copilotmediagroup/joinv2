begin;

revoke execute on function public.get_my_direct_threads() from authenticated;
revoke execute on function public.get_my_signal_connections() from authenticated;
revoke execute on function public.get_my_blocked_users() from authenticated;

comment on function public.get_my_direct_threads()
is 'Legacy unbounded RPC retained for migration history only; browser callers must use get_my_direct_threads_page.';

comment on function public.get_my_signal_connections()
is 'Legacy unbounded RPC retained for migration history only; browser callers must use get_my_signal_connections_page.';

comment on function public.get_my_blocked_users()
is 'Legacy unbounded RPC retained for migration history only; browser callers must use get_my_blocked_users_page.';

commit;
