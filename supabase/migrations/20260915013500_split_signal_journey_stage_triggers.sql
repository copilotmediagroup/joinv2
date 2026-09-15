begin;

-- Trigger records are table-specific. Keep NEW field access inside a function
-- whose trigger table actually owns that field.
create or replace function public.sync_signal_plan_journey_stage()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
  if new.originating_signal_group_id is not null then
    update public.signal_groups
    set journey_stage='plan',updated_at=clock_timestamp()
    where id=new.originating_signal_group_id
      and journey_stage in ('forming','arrival','places','time');
  end if;
  return new;
end;$function$;

create or replace function public.sync_signal_attendance_journey_stage()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
  if new.evidence_type='self_reported'::public.attendance_evidence_type then
    update public.signal_groups sg
    set journey_stage='active_outing',updated_at=clock_timestamp()
    from public.plans p
    where p.id=new.plan_id
      and p.originating_signal_group_id=sg.id
      and sg.journey_stage='plan';
  end if;
  return new;
end;$function$;

drop trigger if exists plans_sync_signal_journey_stage on public.plans;
create trigger plans_sync_signal_journey_stage after insert on public.plans
for each row execute function public.sync_signal_plan_journey_stage();

drop trigger if exists attendance_sync_signal_journey_stage on public.attendance_records;
create trigger attendance_sync_signal_journey_stage after insert on public.attendance_records
for each row execute function public.sync_signal_attendance_journey_stage();

commit;
