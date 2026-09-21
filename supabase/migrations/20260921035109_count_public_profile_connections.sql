begin;

create or replace function public.get_signal_public_profile_connection_count(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_viewer uuid:=auth.uid();
  v_count integer;
begin
  if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_user_id is null then raise exception 'profile_user_required' using errcode='22023'; end if;
  if p_user_id<>v_viewer and public.users_have_block_relation(v_viewer,p_user_id) then
    raise exception 'profile_unavailable' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.user_profiles up
    where up.user_id=p_user_id
      and up.completion_state='complete'::public.profile_completion_state
  ) then raise exception 'profile_not_found' using errcode='P0001'; end if;

  select count(*)::integer
  into v_count
  from public.signal_connections sc
  join public.user_profiles other
    on other.user_id=case when sc.user_low_id=p_user_id then sc.user_high_id else sc.user_low_id end
  where sc.state='accepted'::public.signal_connection_state
    and (sc.user_low_id=p_user_id or sc.user_high_id=p_user_id)
    and not public.users_have_block_relation(v_viewer,other.user_id);

  return coalesce(v_count,0);
end;
$function$;

alter function public.get_signal_public_profile_connection_count(uuid) owner to postgres;
revoke all on function public.get_signal_public_profile_connection_count(uuid) from public,anon;
grant execute on function public.get_signal_public_profile_connection_count(uuid) to authenticated;

comment on function public.get_signal_public_profile_connection_count(uuid)
is 'Returns the exact accepted connection count visible to the authenticated viewer for a visible SIGNAL profile.';

commit;
