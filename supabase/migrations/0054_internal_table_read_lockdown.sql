begin;

-- SIGNAL Migration 0054: signed-in direct-read minimization.
-- If an RLS-enabled table exposes no authenticated/public SELECT policy,
-- it is not a browser read contract. Keep those tables reachable only
-- through explicit RPC/service authority.

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
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname='public'
          and p.tablename=c.relname
          and p.cmd='SELECT'
          and (
            'authenticated'=any(p.roles)
            or 'public'=any(p.roles)
          )
      )
  loop
    execute format('revoke select on table public.%I from authenticated',r.relname);
  end loop;
end
$block$;

commit;
