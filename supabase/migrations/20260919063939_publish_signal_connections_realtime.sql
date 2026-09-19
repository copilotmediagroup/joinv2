begin;

-- Signal connection UI subscribes to pair-scoped changes. The table already
-- exposes SELECT only to authenticated pair participants under RLS; publishing
-- it makes those authorized invalidations deliverable without widening writes.
do $$
begin
  if not exists (
    select 1 from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'signal_connections'
  ) then
    alter publication supabase_realtime
      add table public.signal_connections;
  end if;
end
$$;

commit;
