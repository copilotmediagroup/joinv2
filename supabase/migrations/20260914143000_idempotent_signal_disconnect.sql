begin;

create or replace function public.disconnect_my_signal_connection(
  p_connection_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_connection public.signal_connections%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select sc.* into v_connection
  from public.signal_connections sc
  where sc.id=p_connection_id
  for update;

  if not found then
    return true;
  end if;

  if v_user_id not in (v_connection.user_low_id,v_connection.user_high_id) then
    raise exception 'connection_access_denied' using errcode='42501';
  end if;

  if v_connection.state<>'accepted'::public.signal_connection_state then
    raise exception 'connection_not_connected' using errcode='P0001';
  end if;

  delete from public.signal_connections
  where id=p_connection_id;

  return true;
end;
$function$;

alter function public.disconnect_my_signal_connection(uuid) owner to postgres;
revoke all on function public.disconnect_my_signal_connection(uuid) from public,anon;
grant execute on function public.disconnect_my_signal_connection(uuid) to authenticated;

comment on function public.disconnect_my_signal_connection(uuid)
is 'Idempotent authenticated disconnect. Existing rows require pair membership; already-removed IDs succeed for transport retry recovery.';

commit;
