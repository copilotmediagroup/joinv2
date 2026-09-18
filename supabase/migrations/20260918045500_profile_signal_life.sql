begin;

create or replace function public.get_my_profile_signal_moments(p_limit integer default 60)
returns table(
  moment_id uuid,plan_id uuid,caption text,published_at timestamptz,
  activity_name text,city_name text,state_code text,venue_name text,
  signal_count integer,comment_count integer,media jsonb
)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,60),1),120);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  return query
  select sm.id,sm.plan_id,sm.caption,sm.published_at,a.name,c.name,s.code,nullif(btrim(v.name),''),
    (select count(*)::integer from public.signal_moment_signals sms where sms.moment_id=sm.id),
    (select count(*)::integer from public.signal_moment_comments cm where cm.moment_id=sm.id and cm.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('storagePath',mm.storage_path,'mediaKind',mm.media_kind,'mimeType',mm.mime_type) order by mm.sort_order,mm.id)
      from public.signal_moment_media mm where mm.moment_id=sm.id),'[]'::jsonb)
  from public.signal_moments sm
  join public.plans p on p.id=sm.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  left join public.venues v on v.id=p.current_venue_id
  where sm.author_user_id=v_user_id and sm.state='published' and sm.published_at is not null
  order by sm.published_at desc,sm.id desc limit v_limit;
end;$function$;

alter function public.get_my_profile_signal_moments(integer) owner to postgres;
revoke all on function public.get_my_profile_signal_moments(integer) from public,anon;
grant execute on function public.get_my_profile_signal_moments(integer) to authenticated;
comment on function public.get_my_profile_signal_moments(integer)
is 'Returns only the authenticated user published media captured through real SIGNAL Moments for the visual profile history.';
commit;
