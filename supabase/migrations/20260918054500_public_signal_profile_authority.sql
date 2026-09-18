begin;

create or replace function public.get_signal_public_profile(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare
  v_viewer uuid:=auth.uid();
  v_result jsonb;
begin
  if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_user_id is null then raise exception 'profile_user_required' using errcode='22023'; end if;
  if p_user_id<>v_viewer and public.users_have_block_relation(v_viewer,p_user_id) then
    raise exception 'profile_unavailable' using errcode='42501';
  end if;

  select jsonb_build_object(
    'userId',up.user_id,'displayName',coalesce(up.display_name,'SIGNAL member'),
    'avatarPath',up.avatar_path,'bio',up.bio,
    'age',case when up.birth_date is null then null else date_part('year',age(current_date,up.birth_date))::integer end,
    'cityName',c.name,'stateCode',s.code,
    'signalsJoined',(select count(distinct pm.plan_id)::integer from public.plan_memberships pm join public.plans p on p.id=pm.plan_id where pm.user_id=up.user_id and p.origin='signal'::public.plan_origin and pm.membership_state<>'removed'::public.plan_membership_state),
    'completedMeetups',(select count(distinct pm.plan_id)::integer from public.plan_memberships pm join public.plans p on p.id=pm.plan_id where pm.user_id=up.user_id and p.origin='signal'::public.plan_origin and p.state='completed'::public.plan_state and pm.membership_state<>'removed'::public.plan_membership_state),
    'verifiedShowUps',(select count(distinct ar.plan_id)::integer from public.attendance_records ar join public.plans p on p.id=ar.plan_id where ar.user_id=up.user_id and p.origin='signal'::public.plan_origin and ar.evidence_type in ('location_supported'::public.attendance_evidence_type,'partner_verified'::public.attendance_evidence_type,'system_verified'::public.attendance_evidence_type)),
    'connectionState',case when p_user_id=v_viewer then 'self' when exists(select 1 from public.signal_connections sc where sc.state='accepted'::public.signal_connection_state and sc.user_low_id=least(v_viewer,p_user_id) and sc.user_high_id=greatest(v_viewer,p_user_id)) then 'connected' else 'none' end
  ) into v_result
  from public.user_profiles up
  left join public.cities c on c.id=up.home_city_id
  left join public.states s on s.id=c.state_id
  where up.user_id=p_user_id and up.completion_state='complete'::public.profile_completion_state;

  if v_result is null then raise exception 'profile_not_found' using errcode='P0001'; end if;
  return v_result;
end;$function$;

alter function public.get_signal_public_profile(uuid) owner to postgres;
revoke all on function public.get_signal_public_profile(uuid) from public,anon;
grant execute on function public.get_signal_public_profile(uuid) to authenticated;

create or replace function public.get_signal_public_profile_moments(p_user_id uuid,p_limit integer default 60)
returns table(moment_id uuid,plan_id uuid,caption text,published_at timestamptz,activity_name text,city_name text,state_code text,venue_name text,signal_count integer,comment_count integer,media jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_viewer uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,60),1),120);
begin
  if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_user_id is null or public.users_have_block_relation(v_viewer,p_user_id) then raise exception 'profile_unavailable' using errcode='42501'; end if;
  return query
  select sm.id,sm.plan_id,sm.caption,sm.published_at,a.name,c.name,s.code,nullif(btrim(v.name),''),
    (select count(*)::integer from public.signal_moment_signals sms where sms.moment_id=sm.id),
    (select count(*)::integer from public.signal_moment_comments cm where cm.moment_id=sm.id and cm.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('storagePath',mm.storage_path,'mediaKind',mm.media_kind,'mimeType',mm.mime_type) order by mm.sort_order,mm.id) from public.signal_moment_media mm where mm.moment_id=sm.id),'[]'::jsonb)
  from public.signal_moments sm join public.plans p on p.id=sm.plan_id join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id join public.states s on s.id=c.state_id left join public.venues v on v.id=p.current_venue_id
  where sm.author_user_id=p_user_id and sm.state='published' and sm.published_at is not null
  order by sm.published_at desc,sm.id desc limit v_limit;
end;$function$;

alter function public.get_signal_public_profile_moments(uuid,integer) owner to postgres;
revoke all on function public.get_signal_public_profile_moments(uuid,integer) from public,anon;
grant execute on function public.get_signal_public_profile_moments(uuid,integer) to authenticated;

comment on function public.get_signal_public_profile(uuid)
is 'Public social profile boundary: identity, compact bio, city, system-earned Signal stats and connection state. Matching preferences and protected account fields are excluded.';
comment on function public.get_signal_public_profile_moments(uuid,integer)
is 'Returns only published Signal Moment media for a visible authenticated profile.';
commit;
