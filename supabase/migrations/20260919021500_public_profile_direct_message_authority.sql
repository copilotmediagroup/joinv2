begin;

create or replace function public.get_or_create_my_direct_conversation_with_user(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_connection_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_other_user_id is null or p_other_user_id=v_user_id then
    raise exception 'other_user_required' using errcode='22023';
  end if;
  if public.users_have_block_relation(v_user_id,p_other_user_id) then
    raise exception 'profile_unavailable' using errcode='42501';
  end if;

  select sc.id into v_connection_id
  from public.signal_connections sc
  where sc.state='accepted'::public.signal_connection_state
    and sc.user_low_id=least(v_user_id,p_other_user_id)
    and sc.user_high_id=greatest(v_user_id,p_other_user_id);

  if v_connection_id is null then
    raise exception 'active_connection_required' using errcode='42501';
  end if;

  return public.get_or_create_my_direct_conversation(v_connection_id);
end;
$function$;

alter function public.get_or_create_my_direct_conversation_with_user(uuid) owner to postgres;
revoke all on function public.get_or_create_my_direct_conversation_with_user(uuid) from public,anon;
grant execute on function public.get_or_create_my_direct_conversation_with_user(uuid) to authenticated;

comment on function public.get_or_create_my_direct_conversation_with_user(uuid)
is 'Opens the authoritative persistent DM for an accepted SIGNAL connection by the other user id; resolves the private connection id server-side.';

commit;
