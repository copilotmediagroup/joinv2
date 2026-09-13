begin;

create or replace function public.mark_my_direct_conversation_read(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_count integer:=0;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.direct_conversations dc
    join public.signal_connections sc
      on sc.id=dc.connection_id
     and sc.state='accepted'::public.signal_connection_state
    where dc.id=p_conversation_id
      and dc.state='active'
      and v_user_id in (dc.user_low_id,dc.user_high_id)
  ) then
    raise exception 'direct_conversation_access_denied' using errcode='42501';
  end if;

  update public.direct_messages
  set read_at=coalesce(read_at,clock_timestamp())
  where conversation_id=p_conversation_id
    and sender_user_id<>v_user_id
    and read_at is null;

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

alter function public.mark_my_direct_conversation_read(uuid) owner to postgres;
revoke all on function public.mark_my_direct_conversation_read(uuid) from public,anon;
grant execute on function public.mark_my_direct_conversation_read(uuid) to authenticated;

commit;
