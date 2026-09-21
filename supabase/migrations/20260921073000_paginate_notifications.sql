begin;

create or replace function public.get_my_notifications_page(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table(
  id uuid,type text,title text,body text,state public.notification_state,
  related_plan_id uuid,related_signal_group_id uuid,related_entity_id uuid,
  created_at timestamptz,read_at timestamptz
)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'invalid_notification_cursor' using errcode='22023'; end if;
  return query
  select n.id,n.type,n.title,n.body,n.state,n.related_plan_id,n.related_signal_group_id,n.related_entity_id,n.created_at,n.read_at
  from public.notifications n
  where n.user_id=v_user_id
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
  order by n.created_at desc,n.id desc
  limit v_limit;
end;$function$;

alter function public.get_my_notifications_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_notifications_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_notifications_page(timestamptz,uuid,integer) to authenticated;
comment on function public.get_my_notifications_page(timestamptz,uuid,integer)
is 'Bounded keyset notification history scoped to the authenticated owner.';

commit;
