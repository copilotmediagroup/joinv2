begin;

-- Migration 0038: trigger-only notification functions must not be RPC-callable.
revoke all on function public.notify_signal_group_state_change() from public, anon, authenticated;
revoke all on function public.notify_signal_one_more() from public, anon, authenticated;
revoke all on function public.notify_venue_round_opened() from public, anon, authenticated;
revoke all on function public.notify_time_round_opened() from public, anon, authenticated;
revoke all on function public.notify_plan_member_created() from public, anon, authenticated;
revoke all on function public.notify_plan_join_request_change() from public, anon, authenticated;
revoke all on function public.notify_plan_change_proposal_change() from public, anon, authenticated;
revoke all on function public.notify_plan_history_update() from public, anon, authenticated;

commit;
