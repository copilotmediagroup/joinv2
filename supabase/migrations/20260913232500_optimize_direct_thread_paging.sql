begin;

create index if not exists direct_conversations_low_activity_idx
on public.direct_conversations(user_low_id,state,updated_at desc,id desc);

create index if not exists direct_conversations_high_activity_idx
on public.direct_conversations(user_high_id,state,updated_at desc,id desc);

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
  with eligible as (
    select dc.id,dc.connection_id,dc.user_high_id as other_user_id,dc.updated_at as sort_at
    from public.direct_conversations dc
    join public.signal_connections sc on sc.id=dc.connection_id
      and sc.state='accepted'::public.signal_connection_state
    where dc.user_low_id=v_user_id and dc.state='active'
    union all
    select dc.id,dc.connection_id,dc.user_low_id as other_user_id,dc.updated_at as sort_at
    from public.direct_conversations dc
    join public.signal_connections sc on sc.id=dc.connection_id
      and sc.state='accepted'::public.signal_connection_state
    where dc.user_high_id=v_user_id and dc.state='active'
  ), page as (
    select e.* from eligible e
    where p_after_sort_at is null
       or (e.sort_at,e.id) < (p_after_sort_at,p_after_conversation_id)
    order by e.sort_at desc,e.id desc
    limit p_limit
  )
  select
    p.id,
    p.connection_id,
    p.other_user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    lm.body,
    lm.sent_at,
    (select count(*)::integer
       from public.direct_messages dm
      where dm.conversation_id=p.id
        and dm.sender_user_id<>v_user_id
        and dm.read_at is null),
    p.sort_at
  from page p
  join public.user_profiles up on up.user_id=p.other_user_id
  left join lateral (
    select dm.body,dm.sent_at
    from public.direct_messages dm
    where dm.conversation_id=p.id
    order by dm.sent_at desc,dm.id desc
    limit 1
  ) lm on true
  order by p.sort_at desc,p.id desc;
end;
$function$;

alter function public.get_my_direct_threads_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_direct_threads_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_direct_threads_page(timestamptz,uuid,integer) to authenticated;
comment on function public.get_my_direct_threads_page(timestamptz,uuid,integer)
is 'Returns a bounded cursor page of active DM threads, selecting the page before message metadata work.';

commit;
