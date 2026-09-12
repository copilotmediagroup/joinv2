begin;

-- Migration 0040: authoritative Plan-governance realtime invalidation.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='plan_join_requests'
  ) then
    alter publication supabase_realtime add table public.plan_join_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='plan_join_request_votes'
  ) then
    alter publication supabase_realtime add table public.plan_join_request_votes;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='plan_change_proposals'
  ) then
    alter publication supabase_realtime add table public.plan_change_proposals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='plan_change_votes'
  ) then
    alter publication supabase_realtime add table public.plan_change_votes;
  end if;
end $$;

commit;
