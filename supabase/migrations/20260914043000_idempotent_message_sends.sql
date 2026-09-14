begin;

alter table public.messages
  add column if not exists client_message_id uuid;

alter table public.direct_messages
  add column if not exists client_message_id uuid;

create unique index if not exists messages_sender_client_message_key
  on public.messages (conversation_id, sender_user_id, client_message_id)
  where client_message_id is not null;

create unique index if not exists direct_messages_sender_client_message_key
  on public.direct_messages (conversation_id, sender_user_id, client_message_id)
  where client_message_id is not null;

create or replace function public.send_plan_message_v2(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_user_id uuid,
  body text,
  sent_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_body text;
  v_plan_id uuid;
  v_plan_state public.plan_state;
  v_interval_id uuid;
  v_message public.messages%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_conversation_id is null then
    raise exception 'conversation_id_required' using errcode = '22023';
  end if;
  if p_client_message_id is null then
    raise exception 'client_message_id_required' using errcode = '22023';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if length(v_body) = 0 then
    raise exception 'message_body_required' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'message_body_too_long' using errcode = '22023';
  end if;

  select p.id, p.state
  into v_plan_id, v_plan_state
  from public.conversations c
  join public.plans p on p.id = c.plan_id
  where c.id = p_conversation_id
  for update of p;

  if v_plan_id is null then
    raise exception 'plan_conversation_not_found' using errcode = '22023';
  end if;
  if v_plan_state not in ('locked','recovery_required','active_outing') then
    raise exception 'plan_messaging_read_only' using errcode = '55000';
  end if;

  select cmi.id into v_interval_id
  from public.conversation_membership_intervals cmi
  where cmi.conversation_id = p_conversation_id
    and cmi.user_id = v_user_id
    and cmi.started_at <= v_now
    and cmi.ended_at is null
  order by cmi.started_at desc, cmi.id desc
  limit 1
  for update;

  if v_interval_id is null then
    raise exception 'conversation_membership_required' using errcode = '42501';
  end if;

  select m.* into v_message
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_user_id = v_user_id
    and m.client_message_id = p_client_message_id;

  if v_message.id is null then
    insert into public.messages (
      conversation_id, sender_user_id, body, sent_at, client_message_id
    ) values (
      p_conversation_id, v_user_id, v_body, v_now, p_client_message_id
    )
    on conflict (conversation_id, sender_user_id, client_message_id)
      where client_message_id is not null
    do nothing
    returning * into v_message;

    if v_message.id is null then
      select m.* into v_message
      from public.messages m
      where m.conversation_id = p_conversation_id
        and m.sender_user_id = v_user_id
        and m.client_message_id = p_client_message_id;
    end if;
  end if;

  return query select
    v_message.id,
    v_message.conversation_id,
    v_message.sender_user_id,
    v_message.body,
    v_message.sent_at;
end;
$function$;

create or replace function public.send_my_direct_message_v2(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
)
returns table(message_id uuid,sender_user_id uuid,body text,sent_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_other_user_id uuid;
  v_message public.direct_messages%rowtype;
  v_now timestamptz := clock_timestamp();
  v_body text := btrim(coalesce(p_body,''));
  v_created boolean := false;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_conversation_id is null then raise exception 'conversation_id_required' using errcode='22023'; end if;
  if p_client_message_id is null then raise exception 'client_message_id_required' using errcode='22023'; end if;
  if length(v_body)=0 or char_length(v_body)>4000 then raise exception 'invalid_message_body' using errcode='22023'; end if;

  select case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end
  into v_other_user_id
  from public.direct_conversations dc
  join public.signal_connections sc on sc.id=dc.connection_id and sc.state='accepted'::public.signal_connection_state
  where dc.id=p_conversation_id and dc.state='active' and v_user_id in (dc.user_low_id,dc.user_high_id)
  for update of dc;
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  select dm.* into v_message
  from public.direct_messages dm
  where dm.conversation_id=p_conversation_id
    and dm.sender_user_id=v_user_id
    and dm.client_message_id=p_client_message_id;

  if v_message.id is null then
    insert into public.direct_messages(conversation_id,sender_user_id,body,sent_at,client_message_id)
    values(p_conversation_id,v_user_id,v_body,v_now,p_client_message_id)
    on conflict (conversation_id,sender_user_id,client_message_id)
      where client_message_id is not null
    do nothing
    returning * into v_message;

    if v_message.id is null then
      select dm.* into v_message
      from public.direct_messages dm
      where dm.conversation_id=p_conversation_id
        and dm.sender_user_id=v_user_id
        and dm.client_message_id=p_client_message_id;
    else
      v_created := true;
    end if;
  end if;

  if v_created then
    update public.direct_conversations set updated_at=v_now where id=p_conversation_id;
    insert into public.notifications(user_id,type,title,body,related_entity_id,dedupe_key,created_at)
    values(v_other_user_id,'direct_message','NEW MESSAGE','Someone you connected with sent you a message.',p_conversation_id,
      'direct-message:'||v_message.id::text||':'||v_other_user_id::text,v_now)
    on conflict(user_id,dedupe_key) do nothing;
  end if;

  return query select v_message.id,v_message.sender_user_id,v_message.body,v_message.sent_at;
end;
$function$;

alter function public.send_plan_message_v2(uuid,text,uuid) owner to postgres;
alter function public.send_my_direct_message_v2(uuid,text,uuid) owner to postgres;
revoke all on function public.send_plan_message_v2(uuid,text,uuid) from public,anon;
revoke all on function public.send_my_direct_message_v2(uuid,text,uuid) from public,anon;
grant execute on function public.send_plan_message_v2(uuid,text,uuid) to authenticated;
grant execute on function public.send_my_direct_message_v2(uuid,text,uuid) to authenticated;

commit;
