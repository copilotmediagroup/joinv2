begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists user_profiles_complete_display_name_trgm_idx
on public.user_profiles using gin (display_name extensions.gin_trgm_ops)
where completion_state = 'complete'::public.profile_completion_state;

comment on index public.user_profiles_complete_display_name_trgm_idx is
  'Supports bounded authenticated display-name substring search without full profile-table scans at scale.';

commit;
