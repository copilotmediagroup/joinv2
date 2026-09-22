begin;

-- Mobile browsers can suspend/resume Realtime long enough to miss a 10-second
-- venue round entirely. Keep time coordination fast, but give every confirmed
-- Signal member a practical server-owned window to enter and vote on Place.
do $migration$
declare
  v_sql text;
begin
  select pg_get_functiondef('public.ensure_signal_venue_round(uuid,jsonb)'::regprocedure)
  into v_sql;

  if position('10 seconds' in v_sql) = 0 then
    raise exception 'ensure_signal_venue_round expected 10-second contract not found';
  end if;

  execute replace(v_sql, '10 seconds', '60 seconds');
end
$migration$;

commit;
