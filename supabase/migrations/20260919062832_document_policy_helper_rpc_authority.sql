begin;

-- These SECURITY DEFINER helpers are intentionally executable by authenticated
-- because Postgres evaluates them from authenticated RLS policies. They are
-- boolean predicates only, derive caller identity from auth.uid(), and do not
-- accept a caller-supplied user id. Keep anon/PUBLIC closed and document the
-- browser-visible RPC surface so future audits do not mistake it for an
-- unreviewed privilege escalation.

revoke all on function public.is_active_plan_member(uuid) from public, anon;
grant execute on function public.is_active_plan_member(uuid) to authenticated, service_role;
comment on function public.is_active_plan_member(uuid)
is 'RLS membership predicate intentionally executable by authenticated. Returns only a boolean for auth.uid(); SECURITY DEFINER prevents recursive plan-membership policy evaluation.';

revoke all on function public.is_signal_group_member(uuid) from public, anon;
grant execute on function public.is_signal_group_member(uuid) to authenticated, service_role;
comment on function public.is_signal_group_member(uuid)
is 'RLS membership predicate intentionally executable by authenticated. Returns only a boolean for auth.uid(); SECURITY DEFINER prevents recursive Signal-membership policy evaluation.';

revoke all on function public.can_upload_signal_moment_object(text) from public, anon;
grant execute on function public.can_upload_signal_moment_object(text) to authenticated, service_role;
comment on function public.can_upload_signal_moment_object(text)
is 'Storage RLS predicate intentionally executable by authenticated. Returns only whether auth.uid() may upload the supplied Signal Moment object path.';

revoke all on function public.can_read_signal_moment_object(text) from public, anon;
grant execute on function public.can_read_signal_moment_object(text) to authenticated, service_role;
comment on function public.can_read_signal_moment_object(text)
is 'Storage RLS predicate intentionally executable by authenticated. Returns only whether auth.uid() may read the supplied Signal Moment object path.';

revoke all on function public.can_delete_signal_moment_object(text) from public, anon;
grant execute on function public.can_delete_signal_moment_object(text) to authenticated, service_role;
comment on function public.can_delete_signal_moment_object(text)
is 'Storage RLS predicate intentionally executable by authenticated. Returns only whether auth.uid() may delete the supplied Signal Moment object path.';

commit;
