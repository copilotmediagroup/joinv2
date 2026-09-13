begin;

create or replace function public.get_my_direct_thread(p_conversation_id uuid)
returns table(
  conversation_id uuid,
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  last_message_body text,
  last_message_at timestamptz,
  unread_count integer,
  sort_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  return query
  select
    dc.id,
    dc.connection_id,
    case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    lm.body,
    lm.sent_at,
    (select count(*)::integer
       from public.direct_messages dm
      where dm.conversation_id=dc.id
        and dm.sender_user_id<>v_user_id
        and dm.read_at is null),
    coalesce(lm.sent_at,dc.updated_at)
  from public.direct_conversations dc
  join public.signal_connections sc
    on sc.id=dc.connection_id
   and sc.state='accepted'::public.signal_connection_state
  join public.user_profiles up
    on up.user_id=case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end
  left join lateral (
    select dm.body,dm.sent_at
    from public.direct_messages dm
    where dm.conversation_id=dc.id
    order by dm.sent_at desc,dm.id desc
    limit 1
  ) lm on true
  where dc.id=p_conversation_id
    and dc.state='active'
    and v_user_id in (dc.user_low_id,dc.user_high_id);
end;
$function$;
alter function public.get_my_direct_thread(uuid) owner to postgres;
revoke all on function public.get_my_direct_thread(uuid) from public,anon;
grant execute on function public.get_my_direct_thread(uuid) to authenticated;

comment on function public.get_my_direct_thread(uuid)
is 'Returns one authorized active direct-message thread for deep-link hydration without scanning the full thread list.';

commit;
