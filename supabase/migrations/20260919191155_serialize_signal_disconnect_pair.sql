begin;

create or replace function public.disconnect_my_signal_connection(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_connection public.signal_connections%rowtype;
  v_low uuid;
  v_high uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  -- Read identity first, then serialize the same unordered pair used by
  -- request/block authority. The row is re-read FOR UPDATE after waiting.
  select sc.user_low_id,sc.user_high_id into v_low,v_high
  from public.signal_connections sc
  where sc.id=p_connection_id;

  if not found then return true; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|','signal_connection_pair_v1',v_low::text,v_high::text),0)
  );

  select sc.* into v_connection
  from public.signal_connections sc
  where sc.id=p_connection_id
  for update;

  -- A concurrent pair teardown may have removed it while this call waited.
  if not found then return true; end if;

  if v_connection.user_low_id<>v_low or v_connection.user_high_id<>v_high then
    raise exception 'connection_identity_changed' using errcode='40001';
  end if;
  if v_user_id not in (v_connection.user_low_id,v_connection.user_high_id) then
    raise exception 'connection_access_denied' using errcode='42501';
  end if;
  if v_connection.state<>'accepted'::public.signal_connection_state then
    raise exception 'connection_not_connected' using errcode='P0001';
  end if;

  delete from public.signal_connections where id=p_connection_id;
  return true;
end;
$function$;

alter function public.disconnect_my_signal_connection(uuid) owner to postgres;
revoke all on function public.disconnect_my_signal_connection(uuid) from public,anon;
grant execute on function public.disconnect_my_signal_connection(uuid) to authenticated;

comment on function public.disconnect_my_signal_connection(uuid)
is 'Idempotent authenticated disconnect serialized on the canonical private-pair advisory lock before deleting accepted relationship state.';

commit;
