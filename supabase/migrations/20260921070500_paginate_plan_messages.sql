begin;

create or replace function public.get_my_plan_messages_page(
  p_conversation_id uuid,
  p_before_sent_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table(message_id uuid,conversation_id uuid,sender_user_id uuid,body text,sent_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if (p_before_sent_at is null) <> (p_before_id is null) then raise exception 'invalid_plan_message_cursor' using errcode='22023'; end if;
  if not exists(select 1 from public.conversation_membership_intervals cmi where cmi.conversation_id=p_conversation_id and cmi.user_id=v_user_id)
  then raise exception 'conversation_access_denied' using errcode='42501'; end if;

  return query
  select x.id,x.conversation_id,x.sender_user_id,x.body,x.sent_at
  from (
    select m.id,m.conversation_id,m.sender_user_id,m.body,m.sent_at
    from public.messages m
    where m.conversation_id=p_conversation_id
      and exists(
        select 1 from public.conversation_membership_intervals cmi
        where cmi.conversation_id=m.conversation_id and cmi.user_id=v_user_id
          and cmi.started_at<=m.sent_at and (cmi.ended_at is null or m.sent_at<cmi.ended_at)
      )
      and (p_before_sent_at is null or (m.sent_at,m.id)<(p_before_sent_at,p_before_id))
    order by m.sent_at desc,m.id desc
    limit v_limit
  ) x
  order by x.sent_at,x.id;
end;$function$;

alter function public.get_my_plan_messages_page(uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_plan_messages_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_plan_messages_page(uuid,timestamptz,uuid,integer) to authenticated;
comment on function public.get_my_plan_messages_page(uuid,timestamptz,uuid,integer)
is 'Bounded keyset Plan message history constrained to the callers recorded conversation membership intervals.';

commit;
