begin;

create or replace function public.can_access_plan_conversation_realtime_topic(p_topic text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_prefix text:=split_part(coalesce(p_topic,''),':',1);
  v_id_text text:=split_part(coalesce(p_topic,''),':',2);
  v_conversation_id uuid;
begin
  if v_user_id is null or v_prefix not in ('messages','plan-typing') then return false; end if;
  if v_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then return false; end if;
  if p_write and v_prefix<>'plan-typing' then return false; end if;
  v_conversation_id:=v_id_text::uuid;
  return exists(
    select 1 from public.conversation_membership_intervals cmi
    where cmi.conversation_id=v_conversation_id
      and cmi.user_id=v_user_id
      and cmi.ended_at is null
  );
end;$function$;

alter function public.can_access_plan_conversation_realtime_topic(text,boolean) owner to postgres;
revoke all on function public.can_access_plan_conversation_realtime_topic(text,boolean) from public,anon;
grant execute on function public.can_access_plan_conversation_realtime_topic(text,boolean) to authenticated;

create policy plan_conversation_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and public.can_access_plan_conversation_realtime_topic((select realtime.topic()),false)
);

create policy plan_typing_broadcast_send
on realtime.messages for insert to authenticated
with check (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1)='plan-typing'
  and public.can_access_plan_conversation_realtime_topic((select realtime.topic()),true)
);

create or replace function public.broadcast_plan_message_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_conversation_id uuid;
begin
  v_conversation_id:=coalesce(new.conversation_id,old.conversation_id);
  perform realtime.send(jsonb_build_object('changed',true),'refresh','messages:'||v_conversation_id::text,true);
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_plan_message_refresh() owner to postgres;
revoke all on function public.broadcast_plan_message_refresh() from public,anon,authenticated;

drop trigger if exists plan_messages_ui_refresh on public.messages;
create trigger plan_messages_ui_refresh after insert or update or delete on public.messages
for each row execute function public.broadcast_plan_message_refresh();

alter publication supabase_realtime drop table public.messages;

comment on function public.can_access_plan_conversation_realtime_topic(text,boolean)
is 'Authenticated private Plan conversation realtime authorization for current open membership intervals.';
comment on function public.broadcast_plan_message_refresh()
is 'Server-only data-free private invalidation for Plan conversation messages.';

commit;
