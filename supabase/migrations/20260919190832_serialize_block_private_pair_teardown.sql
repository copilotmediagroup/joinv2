begin;

create or replace function public.block_user(p_target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_low uuid;
  v_high uuid;
  v_connection_ids uuid[];
  v_conversation_ids uuid[];
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then raise exception 'invalid_block_target' using errcode='22023'; end if;
  if not exists(select 1 from public.user_profiles where user_id=p_target_user_id) then raise exception 'user_not_found' using errcode='P0001'; end if;

  v_low:=least(v_user_id,p_target_user_id);
  v_high:=greatest(v_user_id,p_target_user_id);

  -- Same unordered-pair lock used by connection creation. This protects the
  -- absent-row case and makes block/request races deterministic.
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|','signal_connection_pair_v1',v_low::text,v_high::text),0)
  );

  -- Canonical private-pair lock order is connection -> conversation.
  -- get_or_create_my_direct_conversation uses this same row order.
  select coalesce(array_agg(sc.id),'{}'::uuid[])
  into v_connection_ids
  from (
    select sc.id
    from public.signal_connections sc
    where sc.user_low_id=v_low and sc.user_high_id=v_high
    for update
  ) sc;

  select coalesce(array_agg(dc.id),'{}'::uuid[])
  into v_conversation_ids
  from (
    select dc.id
    from public.direct_conversations dc
    where dc.user_low_id=v_low and dc.user_high_id=v_high
    for update
  ) dc;

  insert into public.user_blocks(blocker_user_id,blocked_user_id)
  values(v_user_id,p_target_user_id)
  on conflict(blocker_user_id,blocked_user_id) do nothing;

  delete from public.notifications n
  where n.user_id in (v_user_id,p_target_user_id)
    and ((n.type in ('connection_request','connection_accepted') and n.related_entity_id=any(v_connection_ids))
      or (n.type='direct_message' and n.related_entity_id=any(v_conversation_ids)));

  update public.direct_conversations
  set state='closed',closed_at=coalesce(closed_at,clock_timestamp()),updated_at=clock_timestamp()
  where user_low_id=v_low and user_high_id=v_high and state='active';

  delete from public.signal_connections
  where user_low_id=v_low and user_high_id=v_high;

  return true;
end;
$function$;

alter function public.block_user(uuid) owner to postgres;
revoke all on function public.block_user(uuid) from public,anon;
grant execute on function public.block_user(uuid) to authenticated;

comment on function public.block_user(uuid)
is 'Blocks a user and tears down private pair state under the canonical pair, connection, then conversation lock order.';

commit;
