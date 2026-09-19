begin;

-- High-volume reverse lookups and FK maintenance paths identified by the
-- production database advisor. These complement existing composite PKs whose
-- leading column is the parent object rather than the member/user identity.
create index if not exists plan_member_outing_completions_user_idx
  on public.plan_member_outing_completions(user_id, plan_id);

create index if not exists signal_moment_comments_author_idx
  on public.signal_moment_comments(author_user_id, created_at desc, id);

create index if not exists signal_moment_signals_user_idx
  on public.signal_moment_signals(user_id, created_at desc, moment_id);

create index if not exists plan_member_locations_user_idx
  on public.plan_member_locations(user_id, plan_id);

commit;
