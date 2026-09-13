begin;

create or replace function public.get_my_completed_plan_connections(p_plan_id uuid)
returns table (
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  connection_state text,
  request_direction text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.id=p_plan_id
      and p.origin='signal'::public.plan_origin
      and p.state='completed'::public.plan_state
      and pm.user_id=v_user_id
      and pm.membership_state='completed'::public.plan_membership_state
  ) then
    raise exception 'completed_plan_membership_required' using errcode='42501';
  end if;

  return query
  select
    sc.id,
    pm.user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    case
      when sc.id is null then 'none'
      when sc.state='accepted'::public.signal_connection_state then 'connected'
      when sc.state='declined'::public.signal_connection_state then 'declined'
      else 'pending'
    end,
    case
      when sc.id is null then 'none'
      when sc.state<>'pending'::public.signal_connection_state then 'none'
      when sc.requested_by=v_user_id then 'outgoing'
      else 'incoming'
    end
  from public.plan_memberships pm
  join public.user_profiles up on up.user_id=pm.user_id
  left join public.signal_connections sc
    on sc.user_low_id=least(v_user_id,pm.user_id)
   and sc.user_high_id=greatest(v_user_id,pm.user_id)
  where pm.plan_id=p_plan_id
    and pm.user_id<>v_user_id
    and pm.membership_state='completed'::public.plan_membership_state
    and not public.users_have_block_relation(v_user_id,pm.user_id)
  order by pm.joined_at,pm.id;
end;
$function$;

alter function public.get_my_completed_plan_connections(uuid) owner to postgres;
revoke all on function public.get_my_completed_plan_connections(uuid) from public,anon;
grant execute on function public.get_my_completed_plan_connections(uuid) to authenticated;

commit;
