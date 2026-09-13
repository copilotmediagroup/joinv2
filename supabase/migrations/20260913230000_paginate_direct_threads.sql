begin;

create or replace function public.get_my_direct_threads_page(
  p_after_sort_at timestamptz default null,
  p_after_conversation_id uuid default null,
  p_limit integer default 30
)
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
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'invalid_thread_limit' using errcode='22023';
  end if;
  return query
  with thread_base as (
    select
      dc.id as conversation_id,
      dc.connection_id,
      case when dc.user_low_id=v_user_id then dc.user_high_id else dc.user_low_id end as other_user_id,
      coalesce(up.display_name,'SIGNAL member') as display_name,
      up.avatar_path,
      lm.body as last_message_body,
      lm.sent_at as last_message_at,
      coalesce(lm.sent_at,dc.updated_at) as sort_at
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
    where dc.state='active'
      and v_user_id in (dc.user_low_id,dc.user_high_id)
  )
  select
    tb.conversation_id,
    tb.connection_id,
    tb.other_user_id,
    tb.display_name,
    tb.avatar_path,
    tb.last_message_body,
    tb.last_message_at,
    (select count(*)::integer
       from public.direct_messages dm
      where dm.conversation_id=tb.conversation_id
        and dm.sender_user_id<>v_user_id
        and dm.read_at is null) as unread_count,
    tb.sort_at
  from thread_base tb
  where p_after_sort_at is null
     or (tb.sort_at,tb.conversation_id) < (p_after_sort_at,p_after_conversation_id)
  order by tb.sort_at desc,tb.conversation_id desc
  limit p_limit;
end;
$function$;

alter function public.get_my_direct_threads_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_direct_threads_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_direct_threads_page(timestamptz,uuid,integer) to authenticated;

comment on function public.get_my_direct_threads_page(timestamptz,uuid,integer)
is 'Returns a bounded cursor page of active direct-message threads for auth.uid(), newest activity first.';

commit;
