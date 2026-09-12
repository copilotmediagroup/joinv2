begin;

-- SIGNAL Migration 0050: browser table-write lockdown.
-- Browser writes are RPC-authorized; direct public-table mutation is not part
-- of the client contract. Keep SELECT/RLS for reads + Realtime only.

do $block$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table public.%I from anon, authenticated',
      r.relname
    );
  end loop;
end
$block$;

commit;
