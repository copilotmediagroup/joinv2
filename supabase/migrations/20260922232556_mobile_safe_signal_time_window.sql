begin;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='ensure_signal_time_round'
    and pg_get_function_identity_arguments(p.oid)='p_signal_group_id uuid, p_options jsonb';

  if v_definition is null then
    raise exception 'ensure_signal_time_round_definition_missing';
  end if;

  if position('interval ''60 seconds''' in v_definition)>0 then
    return;
  end if;

  if position('interval ''10 seconds''' in v_definition)=0 then
    raise exception 'ensure_signal_time_round_window_contract_changed';
  end if;

  v_updated:=replace(v_definition,'interval ''10 seconds''','interval ''60 seconds''');
  execute v_updated;
end
$migration$;

comment on function public.ensure_signal_time_round(uuid,jsonb)
is 'Creates the authoritative Signal time round with a mobile-safe 60-second participation window.';

commit;
