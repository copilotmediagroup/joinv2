begin;

create or replace function public.get_signal_public_profile_connections(p_user_id uuid,p_limit integer default 24)
returns table(user_id uuid,display_name text,avatar_path text,connected_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_viewer uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,24),1),60);
begin
  if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_user_id is null then raise exception 'profile_user_required' using errcode='22023'; end if;
  if p_user_id<>v_viewer and public.users_have_block_relation(v_viewer,p_user_id) then raise exception 'profile_unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.user_profiles up where up.user_id=p_user_id and up.completion_state='complete'::public.profile_completion_state) then raise exception 'profile_not_found' using errcode='P0001'; end if;

  return query
  select other.user_id,coalesce(other.display_name,'SIGNAL member'),other.avatar_path,coalesce(sc.responded_at,sc.updated_at)
  from public.signal_connections sc
  join public.user_profiles other on other.user_id=case when sc.user_low_id=p_user_id then sc.user_high_id else sc.user_low_id end
  where sc.state='accepted'::public.signal_connection_state
    and (sc.user_low_id=p_user_id or sc.user_high_id=p_user_id)
    and not public.users_have_block_relation(v_viewer,other.user_id)
  order by coalesce(sc.responded_at,sc.updated_at) desc,sc.id desc
  limit v_limit;
end;$function$;

alter function public.get_signal_public_profile_connections(uuid,integer) owner to postgres;
revoke all on function public.get_signal_public_profile_connections(uuid,integer) from public,anon;
grant execute on function public.get_signal_public_profile_connections(uuid,integer) to authenticated;
comment on function public.get_signal_public_profile_connections(uuid,integer)
is 'Public social graph for a visible SIGNAL profile. Returns accepted connections only and filters viewer block relationships.';
commit;
