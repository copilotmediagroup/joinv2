begin;

create or replace function public.sync_signal_journey_stage()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
  if tg_table_name='signal_groups' then
    if new.state in ('coordinating','locked') and new.journey_stage='forming' then new.journey_stage:='arrival'; end if;
    if new.state='completed' then new.journey_stage:='completed'; end if;
    return new;
  end if;
  if tg_table_name='signal_venue_rounds' then
    update public.signal_groups set journey_stage='places',updated_at=clock_timestamp()
    where id=new.signal_group_id and journey_stage in ('forming','arrival');
    return new;
  end if;
  if tg_table_name='signal_time_rounds' then
    update public.signal_groups set journey_stage='time',updated_at=clock_timestamp()
    where id=new.signal_group_id and journey_stage in ('forming','arrival','places');
    return new;
  end if;
  if tg_table_name='plans' and new.originating_signal_group_id is not null then
    update public.signal_groups set journey_stage='plan',updated_at=clock_timestamp()
    where id=new.originating_signal_group_id and journey_stage in ('forming','arrival','places','time');
    return new;
  end if;
  if tg_table_name='attendance_records' and new.evidence_type='self_reported'::public.attendance_evidence_type then
    update public.signal_groups sg set journey_stage='active_outing',updated_at=clock_timestamp()
    from public.plans p where p.id=new.plan_id and p.originating_signal_group_id=sg.id
      and sg.journey_stage='plan';
    return new;
  end if;
  return new;
end;$function$;

drop trigger if exists plans_sync_signal_journey_stage on public.plans;
create trigger plans_sync_signal_journey_stage after insert on public.plans
for each row execute function public.sync_signal_journey_stage();
drop trigger if exists attendance_sync_signal_journey_stage on public.attendance_records;
create trigger attendance_sync_signal_journey_stage after insert on public.attendance_records
for each row execute function public.sync_signal_journey_stage();

update public.signal_groups sg set journey_stage='plan',updated_at=clock_timestamp()
where journey_stage in ('forming','arrival','places','time') and exists(
  select 1 from public.plans p where p.originating_signal_group_id=sg.id and p.state not in ('cancelled','completed')
);
update public.signal_groups sg set journey_stage='active_outing',updated_at=clock_timestamp()
where journey_stage='plan' and exists(
  select 1 from public.plans p join public.attendance_records ar on ar.plan_id=p.id
  where p.originating_signal_group_id=sg.id and ar.evidence_type='self_reported'::public.attendance_evidence_type
);
commit;
