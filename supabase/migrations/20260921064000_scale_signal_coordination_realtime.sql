begin;

create policy signal_coordination_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1) in ('signal-venue','signal-time')
  and case
    when split_part((select realtime.topic()),':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      then public.is_signal_group_member(split_part((select realtime.topic()),':',2)::uuid)
    else false
  end
);

create or replace function public.broadcast_signal_coordination_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_group_id uuid:=coalesce(new.signal_group_id,old.signal_group_id);
  v_prefix text;
begin
  if tg_table_name='signal_venue_rounds' then v_prefix:='signal-venue';
  elsif tg_table_name='signal_time_rounds' then v_prefix:='signal-time';
  else raise exception 'unsupported_signal_coordination_realtime_table';
  end if;
  perform realtime.send(jsonb_build_object('changed',true),'refresh',v_prefix||':'||v_group_id::text,true);
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_signal_coordination_refresh() owner to postgres;
revoke all on function public.broadcast_signal_coordination_refresh() from public,anon,authenticated;

drop trigger if exists signal_venue_rounds_ui_refresh on public.signal_venue_rounds;
create trigger signal_venue_rounds_ui_refresh after insert or update or delete on public.signal_venue_rounds
for each row execute function public.broadcast_signal_coordination_refresh();

drop trigger if exists signal_time_rounds_ui_refresh on public.signal_time_rounds;
create trigger signal_time_rounds_ui_refresh after insert or update or delete on public.signal_time_rounds
for each row execute function public.broadcast_signal_coordination_refresh();

alter publication supabase_realtime drop table public.signal_venue_rounds;
alter publication supabase_realtime drop table public.signal_time_rounds;

comment on function public.broadcast_signal_coordination_refresh()
is 'Server-only data-free private invalidation for Signal venue/time coordination round state.';

commit;
