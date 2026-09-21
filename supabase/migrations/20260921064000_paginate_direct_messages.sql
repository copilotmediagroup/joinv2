begin;

create or replace function public.get_my_direct_messages_page(
  p_conversation_id uuid,
  p_before_sent_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table(message_id uuid,sender_user_id uuid,body text,sent_at timestamptz,read_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if (p_before_sent_at is null) <> (p_before_id is null) then raise exception 'invalid_direct_message_cursor' using errcode='22023'; end if;
  if not exists(
    select 1 from public.direct_conversations dc
    join public.signal_connections sc on sc.id=dc.connection_id and sc.state='accepted'::public.signal_connection_state
    where dc.id=p_conversation_id and dc.state='active' and v_user_id in (dc.user_low_id,dc.user_high_id)
  ) then raise exception 'direct_conversation_access_denied' using errcode='42501'; end if;

  return query
  select x.id,x.sender_user_id,x.body,x.sent_at,x.read_at
  from (
    select dm.id,dm.sender_user_id,dm.body,dm.sent_at,dm.read_at
    from public.direct_messages dm
    where dm.conversation_id=p_conversation_id
      and (p_before_sent_at is null or (dm.sent_at,dm.id)<(p_before_sent_at,p_before_id))
    order by dm.sent_at desc,dm.id desc
    limit v_limit
  ) x
  order by x.sent_at,x.id;
end;$function$;

alter function public.get_my_direct_messages_page(uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_direct_messages_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_direct_messages_page(uuid,timestamptz,uuid,integer) to authenticated;
revoke execute on function public.get_my_direct_messages(uuid,integer) from authenticated;

comment on function public.get_my_direct_messages_page(uuid,timestamptz,uuid,integer)
is 'Bounded keyset page of direct messages for an active connected participant, returned oldest-to-newest within each page.';

commit;
