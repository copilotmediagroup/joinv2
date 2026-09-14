begin;

create index if not exists signal_connections_low_accepted_activity_idx
  on public.signal_connections(
    user_low_id,
    (coalesce(responded_at,updated_at)) desc,
    id desc
  )
  where state='accepted'::public.signal_connection_state;

create index if not exists signal_connections_high_accepted_activity_idx
  on public.signal_connections(
    user_high_id,
    (coalesce(responded_at,updated_at)) desc,
    id desc
  )
  where state='accepted'::public.signal_connection_state;

create or replace function public.get_my_signal_connections_page(
  p_after_connected_at timestamptz default null,
  p_after_connection_id uuid default null,
  p_limit integer default 30
)
returns table(
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  connected_at timestamptz,
  origin_plan_id uuid
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
    raise exception 'invalid_connection_limit' using errcode='22023';
  end if;

  return query
  with candidates as (
    select sc.id,sc.user_high_id as other_user_id,
           coalesce(sc.responded_at,sc.updated_at) as connected_at,
           sc.origin_plan_id
    from public.signal_connections sc
    where sc.user_low_id=v_user_id
      and sc.state='accepted'::public.signal_connection_state
      and (
        p_after_connected_at is null
        or (coalesce(sc.responded_at,sc.updated_at),sc.id)
           < (p_after_connected_at,p_after_connection_id)
      )

    union all

    select sc.id,sc.user_low_id as other_user_id,
           coalesce(sc.responded_at,sc.updated_at) as connected_at,
           sc.origin_plan_id
    from public.signal_connections sc
    where sc.user_high_id=v_user_id
      and sc.state='accepted'::public.signal_connection_state
      and (
        p_after_connected_at is null
        or (coalesce(sc.responded_at,sc.updated_at),sc.id)
           < (p_after_connected_at,p_after_connection_id)
      )
  ), page as (
    select *
    from candidates
    order by connected_at desc,id desc
    limit p_limit
  )
  select
    p.id,
    p.other_user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    p.connected_at,
    p.origin_plan_id
  from page p
  join public.user_profiles up on up.user_id=p.other_user_id
  order by p.connected_at desc,p.id desc;
end;
$function$;

alter function public.get_my_signal_connections_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_signal_connections_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_signal_connections_page(timestamptz,uuid,integer) to authenticated;

comment on function public.get_my_signal_connections_page(timestamptz,uuid,integer)
is 'Returns a bounded cursor page of accepted Signal connections for auth.uid().';

commit;
