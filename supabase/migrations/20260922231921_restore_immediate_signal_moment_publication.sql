begin;

do $migration$
declare
  v_definition text;
  v_search text := E'\n  return v_moment_id;\nend;';
  v_replacement text := E'\n  update public.signal_moments\n  set state=\'published\',\n      published_at=clock_timestamp(),\n      updated_at=clock_timestamp()\n  where id=v_moment_id;\n\n  return v_moment_id;\nend;';
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='capture_my_signal_moment'
    and pg_get_function_identity_arguments(p.oid)='p_plan_id uuid, p_caption text, p_media jsonb';

  if v_definition is null then
    raise exception 'capture_my_signal_moment_definition_missing';
  end if;

  if position('set state=''published''' in v_definition)>0 then
    return;
  end if;

  if position(v_search in v_definition)=0 then
    raise exception 'capture_my_signal_moment_return_contract_changed';
  end if;

  execute replace(v_definition,v_search,v_replacement);
end
$migration$;

update public.signal_moments sm
set state='published',
    published_at=clock_timestamp(),
    updated_at=clock_timestamp()
where sm.state='draft'
  and exists (
    select 1 from public.signal_moment_media smm
    where smm.moment_id=sm.id
  )
  and exists (
    select 1 from public.attendance_records ar
    where ar.plan_id=sm.plan_id
      and ar.user_id=sm.author_user_id
      and ar.evidence_type='self_reported'::public.attendance_evidence_type
  );

comment on function public.capture_my_signal_moment(uuid,text,jsonb)
is 'Serializes checked-in member Moment capture and publishes it immediately to Activity; repeat media paths remain idempotent and the six-item cap remains authoritative.';

commit;
