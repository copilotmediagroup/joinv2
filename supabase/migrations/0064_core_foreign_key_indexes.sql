begin;

-- Cover core foreign-key directions that are not led by an
-- existing composite index. These support deletes, joins, and
-- common production lookups without indexing every dormant table.
create index if not exists activities_grouping_policy_code_idx
  on public.activities(grouping_policy_code);

create index if not exists signal_groups_activity_id_idx
  on public.signal_groups(activity_id);

create index if not exists signal_groups_grouping_policy_id_idx
  on public.signal_groups(grouping_policy_id);

create index if not exists signal_groups_vibe_id_idx
  on public.signal_groups(vibe_id)
  where vibe_id is not null;

create index if not exists signal_intents_activity_id_idx
  on public.signal_intents(activity_id);

create index if not exists signal_intents_vibe_id_idx
  on public.signal_intents(vibe_id)
  where vibe_id is not null;

create index if not exists signal_intents_discovery_session_id_idx
  on public.signal_intents(discovery_session_id)
  where discovery_session_id is not null;

create index if not exists plans_activity_id_idx
  on public.plans(activity_id);

create index if not exists plans_current_venue_id_idx
  on public.plans(current_venue_id)
  where current_venue_id is not null;

create index if not exists user_profiles_home_city_id_idx
  on public.user_profiles(home_city_id)
  where home_city_id is not null;

create index if not exists attendance_records_plan_membership_id_idx
  on public.attendance_records(plan_membership_id);

create index if not exists attendance_records_venue_id_idx
  on public.attendance_records(venue_id)
  where venue_id is not null;

create index if not exists signal_moments_author_user_id_idx
  on public.signal_moments(author_user_id);

create index if not exists signal_moment_reports_reporter_user_id_idx
  on public.signal_moment_reports(reporter_user_id);

commit;
