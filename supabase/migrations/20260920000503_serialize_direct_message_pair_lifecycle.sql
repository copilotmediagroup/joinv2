begin;

create or replace function public.send_my_direct_message_v2(
  p_conversation_id uuid, p_body text, p_client_message_id uuid
)
returns table(message_id uuid,sender_user_id uuid,body text,sent_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_other_user_id uuid; v_low uuid; v_high uuid;
  v_connection_id uuid; v_message public.direct_messages%rowtype;
  v_now timestamptz:=clock_timestamp(); v_body text:=btrim(coalesce(p_body,''));
  v_created boolean:=false;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_conversation_id is null then raise exception 'conversation_id_required' using errcode='22023'; end if;
  if p_client_message_id is null then raise exception 'client_message_id_required' using errcode='22023'; end if;
  if length(v_body)=0 or char_length(v_body)>4000 then raise exception 'invalid_message_body' using errcode='22023'; end if;

  select dc.connection_id,dc.user_low_id,dc.user_high_id
  into v_connection_id,v_low,v_high
  from public.direct_conversations dc
  where dc.id=p_conversation_id and v_user_id in (dc.user_low_id,dc.user_high_id);
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','signal_connection_pair_v1',v_low::text,v_high::text),0
  ));  perform 1 from public.signal_connections sc
  where sc.id=v_connection_id and sc.user_low_id=v_low and sc.user_high_id=v_high
    and sc.state='accepted'::public.signal_connection_state
  for update;
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  select case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end
  into v_other_user_id
  from public.direct_conversations dc
  where dc.id=p_conversation_id and dc.connection_id=v_connection_id
    and dc.state='active' and dc.user_low_id=v_low and dc.user_high_id=v_high
  for update;
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  select dm.* into v_message from public.direct_messages dm
  where dm.conversation_id=p_conversation_id and dm.sender_user_id=v_user_id
    and dm.client_message_id=p_client_message_id;

  if v_message.id is null then
    insert into public.direct_messages(conversation_id,sender_user_id,body,sent_at,client_message_id)
    values(p_conversation_id,v_user_id,v_body,v_now,p_client_message_id)
    on conflict do nothing returning * into v_message;
    if v_message.id is null then
      select dm.* into v_message from public.direct_messages dm
      where dm.conversation_id=p_conversation_id and dm.sender_user_id=v_user_id
        and dm.client_message_id=p_client_message_id;
    else v_created:=true;
    end if;
  end if;

  if v_created then
    update public.direct_conversations set updated_at=v_now where id=p_conversation_id;
    insert into public.notifications(user_id,type,title,body,related_entity_id,dedupe_key,created_at)
    values(v_other_user_id,'direct_message','NEW MESSAGE',
      'Someone you connected with sent you a message.',p_conversation_id,
      'direct-message:'||v_message.id::text||':'||v_other_user_id::text,v_now)
    on conflict(user_id,dedupe_key) do nothing;
  end if;  return query select v_message.id,v_message.sender_user_id,v_message.body,v_message.sent_at;
end;
$function$;

alter function public.send_my_direct_message_v2(uuid,text,uuid) owner to postgres;
revoke all on function public.send_my_direct_message_v2(uuid,text,uuid) from public,anon;
grant execute on function public.send_my_direct_message_v2(uuid,text,uuid) to authenticated;

create or replace function public.mark_my_direct_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_low uuid; v_high uuid; v_connection_id uuid;
  v_count integer:=0;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  select dc.connection_id,dc.user_low_id,dc.user_high_id
  into v_connection_id,v_low,v_high
  from public.direct_conversations dc
  where dc.id=p_conversation_id and v_user_id in (dc.user_low_id,dc.user_high_id);
  if not found then raise exception 'direct_conversation_access_denied' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','signal_connection_pair_v1',v_low::text,v_high::text),0
  ));

  perform 1 from public.signal_connections sc
  where sc.id=v_connection_id and sc.user_low_id=v_low and sc.user_high_id=v_high
    and sc.state='accepted'::public.signal_connection_state
  for update;
  if not found then raise exception 'direct_conversation_access_denied' using errcode='42501'; end if;  perform 1 from public.direct_conversations dc
  where dc.id=p_conversation_id and dc.connection_id=v_connection_id
    and dc.user_low_id=v_low and dc.user_high_id=v_high and dc.state='active'
  for update;
  if not found then raise exception 'direct_conversation_access_denied' using errcode='42501'; end if;

  update public.direct_messages set read_at=coalesce(read_at,clock_timestamp())
  where conversation_id=p_conversation_id and sender_user_id<>v_user_id and read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

alter function public.mark_my_direct_conversation_read(uuid) owner to postgres;
revoke all on function public.mark_my_direct_conversation_read(uuid) from public,anon;
grant execute on function public.mark_my_direct_conversation_read(uuid) to authenticated;

comment on function public.send_my_direct_message_v2(uuid,text,uuid)
is 'Retry-idempotent direct send serialized on canonical pair, connection, then conversation locks so block/disconnect cannot race a stale send.';
comment on function public.mark_my_direct_conversation_read(uuid)
is 'Marks direct messages read only while canonical pair, accepted connection, and active conversation remain locked and authoritative.';

commit;