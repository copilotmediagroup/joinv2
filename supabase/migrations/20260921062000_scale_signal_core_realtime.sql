begin;

create policy signal_group_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1)='signal'
  and case
    when split_part((select realtime.topic()),':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      then public.is_signal_group_member(split_part((select realtime.topic()),':',2)::uuid)
    else false
  end
);

create or replace function public.broadcast_signal_core_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_group_id uuid;
  v_intent_id uuid;
begin
  if tg_table_name='signal_groups' then
    v_group_id:=coalesce(new.id,old.id);
    perform realtime.send(jsonb_build_object('changed',true),'refresh','signal:'||v_group_id::text,true);
  elsif tg_table_name='signal_group_memberships' then
    v_group_id:=coalesce(new.signal_group_id,old.signal_group_id);
    perform realtime.send(jsonb_build_object('changed',true),'refresh','signal:'||v_group_id::text,true);
  elsif tg_table_name='signal_intents' then
    v_intent_id:=coalesce(new.id,old.id);
    for v_group_id in
      select distinct sgm.signal_group_id
      from public.signal_group_memberships sgm
      where sgm.originating_signal_intent_id=v_intent_id
    loop
      perform realtime.send(jsonb_build_object('changed',true),'refresh','signal:'||v_group_id::text,true);
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_signal_core_refresh() owner to postgres;
revoke all on function public.broadcast_signal_core_refresh() from public,anon,authenticated;

drop trigger if exists signal_groups_ui_refresh on public.signal_groups;
create trigger signal_groups_ui_refresh after insert or update or delete on public.signal_groups
for each row execute function public.broadcast_signal_core_refresh();

drop trigger if exists signal_group_memberships_ui_refresh on public.signal_group_memberships;
create trigger signal_group_memberships_ui_refresh after insert or update or delete on public.signal_group_memberships
for each row execute function public.broadcast_signal_core_refresh();

drop trigger if exists signal_intents_journey_ui_refresh on public.signal_intents;
create trigger signal_intents_journey_ui_refresh after insert or update or delete on public.signal_intents
for each row execute function public.broadcast_signal_core_refresh();

alter publication supabase_realtime drop table public.signal_intents;
alter publication supabase_realtime drop table public.signal_groups;
alter publication supabase_realtime drop table public.signal_group_memberships;

comment on function public.broadcast_signal_core_refresh()
is 'Server-only data-free private invalidation for Signal journey/group state. Intent changes resolve through originating membership authority.';

commit;
