begin;
create or replace function public.reconcile_expired_signal_groups(
  p_limit integer default 500
)
returns table (
  expired_group_count integer,
  expired_membership_count integer,
  expired_intent_count integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_group_id uuid;
  v_groups integer:=0;
  v_memberships integer:=0;
  v_intents integer:=0;
  v_count integer:=0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid_reconcile_limit' using errcode='22023';
  end if;

  for v_group_id in
    select sg.id
    from public.signal_groups sg
    where sg.expires_at <= v_now
      and sg.state in ('forming','confirming','coordinating','locked')
      and not exists (
        select 1 from public.plans p
        where p.originating_signal_group_id=sg.id
      )
    order by sg.expires_at,sg.id
    limit p_limit
    for update skip locked
  loop
    update public.signal_groups
    set state='expired'::public.signal_group_state,
        updated_at=v_now
    where id=v_group_id
      and state in ('forming','confirming','coordinating','locked');

    get diagnostics v_count=row_count;
    if v_count=0 then continue; end if;
    v_groups:=v_groups+v_count;

    update public.signal_group_memberships
    set state='timed_out'::public.signal_group_membership_state,
        is_active_core=false,
        ended_at=coalesce(ended_at,v_now),
        replacement_reason=coalesce(replacement_reason,'signal_expired'),
        updated_at=v_now
    where signal_group_id=v_group_id
      and state in ('matched','confirmed');
    get diagnostics v_count=row_count;
    v_memberships:=v_memberships+v_count;

    update public.signal_intents si
    set state='expired'::public.signal_intent_state,
        updated_at=v_now
    where si.state='assigned'::public.signal_intent_state
      and exists (
        select 1
        from public.signal_group_memberships sgm
        where sgm.signal_group_id=v_group_id
          and sgm.originating_signal_intent_id=si.id
      );
    get diagnostics v_count=row_count;
    v_intents:=v_intents+v_count;
  end loop;

-- Active intents can expire without ever being assigned to a group. Retire them too.
update public.signal_intents
set state='expired'::public.signal_intent_state,
updated_at=v_now
where state='active'::public.signal_intent_state
and expires_at<=v_now;
get diagnostics v_count=row_count;
v_intents:=v_intents+v_count;
  return query select v_groups,v_memberships,v_intents;
end;
$function$;

alter function public.reconcile_expired_signal_groups(integer) owner to postgres;
revoke all on function public.reconcile_expired_signal_groups(integer) from public,anon,authenticated;
grant execute on function public.reconcile_expired_signal_groups(integer) to service_role;

commit;
