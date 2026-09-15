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
  return new;
end;$function$;
drop trigger if exists signal_groups_sync_journey_stage on public.signal_groups;
create trigger signal_groups_sync_journey_stage before insert or update of state on public.signal_groups for each row execute function public.sync_signal_journey_stage();
drop trigger if exists signal_venue_rounds_sync_journey_stage on public.signal_venue_rounds;
create trigger signal_venue_rounds_sync_journey_stage after insert on public.signal_venue_rounds for each row execute function public.sync_signal_journey_stage();
drop trigger if exists signal_time_rounds_sync_journey_stage on public.signal_time_rounds;
create trigger signal_time_rounds_sync_journey_stage after insert on public.signal_time_rounds for each row execute function public.sync_signal_journey_stage();
commit;
