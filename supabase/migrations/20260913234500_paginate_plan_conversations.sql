begin;

create index if not exists conversations_created_id_idx
on public.conversations(created_at desc,id desc)
where plan_id is not null;

create or replace function public.get_my_plan_conversations_page(
  p_after_created_at timestamptz default null,
  p_after_conversation_id uuid default null,
  p_limit integer default 30
)
returns table(
  conversation_id uuid,
  plan_id uuid,
  created_at timestamptz
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
    raise exception 'invalid_conversation_limit' using errcode='22023';
  end if;
  return query
  select c.id,c.plan_id,c.created_at
  from public.conversations c
  where c.plan_id is not null
    and exists (
      select 1
      from public.conversation_membership_intervals cmi
      where cmi.conversation_id=c.id
        and cmi.user_id=v_user_id
    )
    and (
      p_after_created_at is null
      or (c.created_at,c.id) < (p_after_created_at,p_after_conversation_id)
    )
  order by c.created_at desc,c.id desc
  limit p_limit;
end;
$function$;

alter function public.get_my_plan_conversations_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_plan_conversations_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_plan_conversations_page(timestamptz,uuid,integer) to authenticated;

comment on function public.get_my_plan_conversations_page(timestamptz,uuid,integer)
is 'Returns a bounded cursor page of Plan conversations authorized by membership history.';
create or replace function public.get_my_plan_conversation(p_plan_id uuid)
returns table(
  conversation_id uuid,
  plan_id uuid,
  created_at timestamptz
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
  select c.id,c.plan_id,c.created_at
  from public.conversations c
  where c.plan_id=p_plan_id
    and exists (
      select 1
      from public.conversation_membership_intervals cmi
      where cmi.conversation_id=c.id
        and cmi.user_id=v_user_id
    )
  limit 1;
end;
$function$;
alter function public.get_my_plan_conversation(uuid) owner to postgres;
revoke all on function public.get_my_plan_conversation(uuid) from public,anon;
grant execute on function public.get_my_plan_conversation(uuid) to authenticated;

comment on function public.get_my_plan_conversation(uuid)
is 'Returns one Plan conversation authorized by membership history for deep-link hydration.';

commit;
