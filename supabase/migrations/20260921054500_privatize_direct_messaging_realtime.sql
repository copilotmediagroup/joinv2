begin;

create or replace function public.can_access_direct_realtime_topic(p_topic text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_prefix text:=split_part(coalesce(p_topic,''),':',1);
  v_id_text text:=split_part(coalesce(p_topic,''),':',2);
  v_conversation_id uuid;
begin
  if v_user_id is null or v_prefix not in ('direct-messages','direct-typing') then return false; end if;
  if v_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then return false; end if;
  v_conversation_id:=v_id_text::uuid;
  return exists(
    select 1
    from public.direct_conversations dc
    left join public.signal_connections sc on sc.id=dc.connection_id
    where dc.id=v_conversation_id
      and v_user_id in (dc.user_low_id,dc.user_high_id)
      and (
        (v_prefix='direct-messages' and not p_write)
        or (dc.state='active' and sc.state='accepted'::public.signal_connection_state)
      )
  );
end;$function$;

alter function public.can_access_direct_realtime_topic(text,boolean) owner to postgres;
revoke all on function public.can_access_direct_realtime_topic(text,boolean) from public,anon;
grant execute on function public.can_access_direct_realtime_topic(text,boolean) to authenticated;

create policy direct_realtime_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and public.can_access_direct_realtime_topic((select realtime.topic()),false)
);

create policy direct_typing_broadcast_send
on realtime.messages for insert to authenticated
with check (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1)='direct-typing'
  and public.can_access_direct_realtime_topic((select realtime.topic()),true)
);

create or replace function public.broadcast_direct_message_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_conversation_id uuid;
begin
  v_conversation_id:=coalesce(new.conversation_id,old.conversation_id);
  perform realtime.send(jsonb_build_object('changed',true),'refresh','direct-messages:'||v_conversation_id::text,true);
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

create or replace function public.broadcast_direct_conversation_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_conversation_id uuid;
begin
  v_conversation_id:=coalesce(new.id,old.id);
  perform realtime.send(jsonb_build_object('changed',true),'refresh','direct-messages:'||v_conversation_id::text,true);
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_direct_message_refresh() owner to postgres;
alter function public.broadcast_direct_conversation_refresh() owner to postgres;
revoke all on function public.broadcast_direct_message_refresh() from public,anon,authenticated;
revoke all on function public.broadcast_direct_conversation_refresh() from public,anon,authenticated;

drop trigger if exists direct_messages_ui_refresh on public.direct_messages;
create trigger direct_messages_ui_refresh after insert or update or delete on public.direct_messages
for each row execute function public.broadcast_direct_message_refresh();

drop trigger if exists direct_conversations_ui_refresh on public.direct_conversations;
create trigger direct_conversations_ui_refresh after insert or update or delete on public.direct_conversations
for each row execute function public.broadcast_direct_conversation_refresh();

alter publication supabase_realtime drop table public.direct_messages;
alter publication supabase_realtime drop table public.direct_conversations;

comment on function public.can_access_direct_realtime_topic(text,boolean)
is 'Authenticated direct realtime topic authorization. Direct message refresh remains readable by conversation participants after closure; typing requires an active accepted connection.';
comment on function public.broadcast_direct_message_refresh()
is 'Server-only data-free private invalidation for a direct conversation.';
comment on function public.broadcast_direct_conversation_refresh()
is 'Server-only data-free private invalidation for direct conversation lifecycle changes.';

commit;
