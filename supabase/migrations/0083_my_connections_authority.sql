begin;

create or replace function public.get_my_signal_connections()
returns table (
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  connected_at timestamptz,
  origin_plan_id uuid
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    sc.id,
    case when sc.user_low_id=auth.uid() then sc.user_high_id else sc.user_low_id end as other_user_id,
    coalesce(up.display_name,'SIGNAL member') as display_name,
    up.avatar_path,
    coalesce(sc.responded_at,sc.updated_at) as connected_at,
    sc.origin_plan_id
  from public.signal_connections sc
  join public.user_profiles up
    on up.user_id=case when sc.user_low_id=auth.uid() then sc.user_high_id else sc.user_low_id end
  where auth.uid() is not null
    and sc.state='accepted'::public.signal_connection_state
    and auth.uid() in (sc.user_low_id,sc.user_high_id)
  order by coalesce(sc.responded_at,sc.updated_at) desc,sc.id;
$$;

alter function public.get_my_signal_connections() owner to postgres;
revoke all on function public.get_my_signal_connections() from public,anon;
grant execute on function public.get_my_signal_connections() to authenticated;

create or replace function public.disconnect_my_signal_connection(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_deleted boolean:=false;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  delete from public.signal_connections
  where id=p_connection_id
    and state='accepted'::public.signal_connection_state
    and v_user_id in (user_low_id,user_high_id);

  v_deleted:=found;
  if not v_deleted then
    raise exception 'connection_not_found' using errcode='P0001';
  end if;

  return true;
end;
$function$;

alter function public.disconnect_my_signal_connection(uuid) owner to postgres;
revoke all on function public.disconnect_my_signal_connection(uuid) from public,anon;
grant execute on function public.disconnect_my_signal_connection(uuid) to authenticated;

commit;
