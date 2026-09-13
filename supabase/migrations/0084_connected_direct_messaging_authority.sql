begin;

create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.user_profiles(user_id) on delete cascade,
  user_high_id uuid not null references public.user_profiles(user_id) on delete cascade,
  connection_id uuid references public.signal_connections(id) on delete set null,
  state text not null default 'active' check (state in ('active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint direct_conversations_distinct_users check (user_low_id<>user_high_id),
  constraint direct_conversations_canonical_order check (user_low_id<user_high_id),
  constraint direct_conversations_pair_key unique(user_low_id,user_high_id)
);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_user_id uuid not null references public.user_profiles(user_id) on delete restrict,
  body text not null,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_body_not_blank check (length(btrim(body))>0),
  constraint direct_messages_body_length check (char_length(body)<=4000)
);

create index direct_conversations_low_state_idx on public.direct_conversations(user_low_id,state);
create index direct_conversations_high_state_idx on public.direct_conversations(user_high_id,state);
create index direct_messages_conversation_sent_idx on public.direct_messages(conversation_id,sent_at,id);
create index direct_messages_unread_idx on public.direct_messages(conversation_id,read_at) where read_at is null;

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
revoke all on public.direct_conversations,public.direct_messages from public,anon,authenticated;
grant all on public.direct_conversations,public.direct_messages to service_role;

create or replace function public.get_or_create_my_direct_conversation(p_connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_connection public.signal_connections%rowtype;
  v_conversation public.direct_conversations%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  select * into v_connection from public.signal_connections
  where id=p_connection_id
    and state='accepted'::public.signal_connection_state
    and v_user_id in (user_low_id,user_high_id)
  for update;
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  select * into v_conversation from public.direct_conversations
  where user_low_id=v_connection.user_low_id and user_high_id=v_connection.user_high_id
  for update;

  if not found then
    insert into public.direct_conversations(user_low_id,user_high_id,connection_id,state,created_at,updated_at)
    values(v_connection.user_low_id,v_connection.user_high_id,v_connection.id,'active',v_now,v_now)
    returning * into v_conversation;
  elsif v_conversation.state<>'active' or v_conversation.connection_id is distinct from v_connection.id then
    update public.direct_conversations
    set connection_id=v_connection.id,state='active',closed_at=null,updated_at=v_now
    where id=v_conversation.id returning * into v_conversation;
  end if;

  return v_conversation.id;
end;
$function$;

create or replace function public.get_my_direct_threads()
returns table(
  conversation_id uuid,
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  last_message_body text,
  last_message_at timestamptz,
  unread_count integer
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select dc.id,dc.connection_id,
    case when dc.user_low_id=auth.uid() then dc.user_high_id else dc.user_low_id end,
    coalesce(up.display_name,'SIGNAL member'),up.avatar_path,
    lm.body,lm.sent_at,
    (select count(*)::integer from public.direct_messages dm
      where dm.conversation_id=dc.id and dm.sender_user_id<>auth.uid() and dm.read_at is null)
  from public.direct_conversations dc
  join public.signal_connections sc on sc.id=dc.connection_id and sc.state='accepted'::public.signal_connection_state
  join public.user_profiles up on up.user_id=case when dc.user_low_id=auth.uid() then dc.user_high_id else dc.user_low_id end
  left join lateral (
    select dm.body,dm.sent_at from public.direct_messages dm
    where dm.conversation_id=dc.id order by dm.sent_at desc,dm.id desc limit 1
  ) lm on true
  where auth.uid() is not null and dc.state='active' and auth.uid() in (dc.user_low_id,dc.user_high_id)
  order by lm.sent_at desc nulls last,dc.updated_at desc;
$$;

create or replace function public.get_my_direct_messages(p_conversation_id uuid,p_limit integer default 100)
returns table(message_id uuid,sender_user_id uuid,body text,sent_at timestamptz,read_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_limit is null or p_limit<1 or p_limit>200 then raise exception 'invalid_message_limit' using errcode='22023'; end if;
  if not exists(
    select 1 from public.direct_conversations dc
    join public.signal_connections sc on sc.id=dc.connection_id and sc.state='accepted'::public.signal_connection_state
    where dc.id=p_conversation_id and dc.state='active' and v_user_id in (dc.user_low_id,dc.user_high_id)
  ) then raise exception 'direct_conversation_access_denied' using errcode='42501'; end if;

  return query
  select x.id,x.sender_user_id,x.body,x.sent_at,x.read_at
  from (
    select dm.* from public.direct_messages dm where dm.conversation_id=p_conversation_id
    order by dm.sent_at desc,dm.id desc limit p_limit
  ) x order by x.sent_at,x.id;
end;
$function$;

create or replace function public.send_my_direct_message(p_conversation_id uuid,p_body text)
returns table(message_id uuid,sender_user_id uuid,body text,sent_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_other_user_id uuid; v_message public.direct_messages%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_body is null or length(btrim(p_body))=0 or char_length(p_body)>4000 then raise exception 'invalid_message_body' using errcode='22023'; end if;

  select case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end
  into v_other_user_id
  from public.direct_conversations dc
  join public.signal_connections sc on sc.id=dc.connection_id and sc.state='accepted'::public.signal_connection_state
  where dc.id=p_conversation_id and dc.state='active' and v_user_id in (dc.user_low_id,dc.user_high_id)
  for update of dc;
  if not found then raise exception 'active_connection_required' using errcode='42501'; end if;

  insert into public.direct_messages(conversation_id,sender_user_id,body,sent_at)
  values(p_conversation_id,v_user_id,btrim(p_body),v_now) returning * into v_message;
  update public.direct_conversations set updated_at=v_now where id=p_conversation_id;

  insert into public.notifications(user_id,type,title,body,related_entity_id,dedupe_key,created_at)
  values(v_other_user_id,'direct_message','NEW MESSAGE','Someone you connected with sent you a message.',p_conversation_id,
    'direct-message:'||v_message.id::text||':'||v_other_user_id::text,v_now)
  on conflict(user_id,dedupe_key) do nothing;

  return query select v_message.id,v_message.sender_user_id,v_message.body,v_message.sent_at;
end;
$function$;

create or replace function public.mark_my_direct_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_count integer:=0;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from public.direct_conversations dc where dc.id=p_conversation_id and v_user_id in(dc.user_low_id,dc.user_high_id)) then
    raise exception 'direct_conversation_access_denied' using errcode='42501';
  end if;
  update public.direct_messages set read_at=coalesce(read_at,clock_timestamp())
  where conversation_id=p_conversation_id and sender_user_id<>v_user_id and read_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

create or replace function public.close_direct_conversation_on_disconnect()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  if old.state='accepted'::public.signal_connection_state then
    update public.direct_conversations
    set state='closed',connection_id=null,closed_at=clock_timestamp(),updated_at=clock_timestamp()
    where user_low_id=old.user_low_id and user_high_id=old.user_high_id and state='active';
  end if;
  return old;
end;
$function$;

drop trigger if exists signal_connection_close_direct_conversation on public.signal_connections;
create trigger signal_connection_close_direct_conversation before delete on public.signal_connections
for each row execute function public.close_direct_conversation_on_disconnect();

alter function public.get_or_create_my_direct_conversation(uuid) owner to postgres;
alter function public.get_my_direct_threads() owner to postgres;
alter function public.get_my_direct_messages(uuid,integer) owner to postgres;
alter function public.send_my_direct_message(uuid,text) owner to postgres;
alter function public.mark_my_direct_conversation_read(uuid) owner to postgres;
alter function public.close_direct_conversation_on_disconnect() owner to postgres;
revoke all on function public.get_or_create_my_direct_conversation(uuid) from public,anon;
revoke all on function public.get_my_direct_threads() from public,anon;
revoke all on function public.get_my_direct_messages(uuid,integer) from public,anon;
revoke all on function public.send_my_direct_message(uuid,text) from public,anon;
revoke all on function public.mark_my_direct_conversation_read(uuid) from public,anon;
revoke all on function public.close_direct_conversation_on_disconnect() from public,anon,authenticated;
grant execute on function public.get_or_create_my_direct_conversation(uuid) to authenticated;
grant execute on function public.get_my_direct_threads() to authenticated;
grant execute on function public.get_my_direct_messages(uuid,integer) to authenticated;
grant execute on function public.send_my_direct_message(uuid,text) to authenticated;
grant execute on function public.mark_my_direct_conversation_read(uuid) to authenticated;

commit;
