begin;

do $publication$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='signal_moments'
  ) then
    alter publication supabase_realtime add table public.signal_moments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='signal_moment_signals'
  ) then
    alter publication supabase_realtime add table public.signal_moment_signals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='signal_moment_comments'
  ) then
    alter publication supabase_realtime add table public.signal_moment_comments;
  end if;
end;
$publication$;

commit;
