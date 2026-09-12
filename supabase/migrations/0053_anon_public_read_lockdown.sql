begin;

-- SIGNAL Migration 0053: unauthenticated public-table read lockdown.
-- The signed-out surface uses Supabase Auth only; onboarding table reads begin
-- after a session exists. Anonymous users therefore need no public-table SELECT.

do $block$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
  loop
    execute format('revoke select on table public.%I from anon',r.relname);
  end loop;
end
$block$;

commit;
