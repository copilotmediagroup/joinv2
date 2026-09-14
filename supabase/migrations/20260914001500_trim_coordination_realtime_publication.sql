begin;

alter publication supabase_realtime drop table
  public.signal_venue_votes,
  public.signal_venue_options,
  public.signal_time_options,
  public.signal_time_availability,
  public.plan_join_request_votes,
  public.plan_change_votes;

commit;
