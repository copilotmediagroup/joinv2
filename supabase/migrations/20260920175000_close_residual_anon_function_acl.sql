begin;

-- Supabase may retain explicit role grants even after PUBLIC is revoked.
-- Authenticated user RPCs are auth-only; trigger functions are never browser RPCs.
revoke all on function public.get_my_chill_dating_preferences() from anon;
revoke all on function public.update_my_chill_dating_preferences(public.profile_gender,integer,integer,boolean) from anon;
revoke all on function public.get_my_signal_discovery_realtime_topic() from anon;

revoke all on function public.broadcast_signal_discovery_change() from public,anon,authenticated;
revoke all on function public.sync_signal_attendance_journey_stage() from public,anon,authenticated;
revoke all on function public.sync_signal_journey_stage() from public,anon,authenticated;
revoke all on function public.sync_signal_plan_journey_stage() from public,anon,authenticated;
revoke all on function public.sync_terminal_plan_signal_state() from public,anon,authenticated;

-- check_account_access intentionally remains executable by anon because PostgREST
-- invokes it as pgrst.db_pre_request before both anonymous and authenticated calls.
commit;
