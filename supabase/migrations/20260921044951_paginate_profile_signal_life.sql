begin;

create index if not exists signal_moments_profile_history_idx
  on public.signal_moments(author_user_id,published_at desc,id desc)
  where state='published' and published_at is not null;

create or replace function public.get_my_profile_signal_moments_page(
  p_after_published_at timestamptz default null,p_after_id uuid default null,p_limit integer default 12
)
returns table(moment_id uuid,plan_id uuid,caption text,published_at timestamptz,activity_name text,city_name text,state_code text,venue_name text,signal_count integer,comment_count integer,media jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,12),1),24);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if (p_after_published_at is null) <> (p_after_id is null) then raise exception 'invalid_profile_moment_cursor' using errcode='22023'; end if;
  return query
  select sm.id,sm.plan_id,sm.caption,sm.published_at,a.name,c.name,s.code,nullif(btrim(v.name),''),
    (select count(*)::integer from public.signal_moment_signals sms where sms.moment_id=sm.id),
    (select count(*)::integer from public.signal_moment_comments cm where cm.moment_id=sm.id and cm.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('storagePath',mm.storage_path,'mediaKind',mm.media_kind,'mimeType',mm.mime_type) order by mm.sort_order,mm.id) from public.signal_moment_media mm where mm.moment_id=sm.id),'[]'::jsonb)
  from public.signal_moments sm join public.plans p on p.id=sm.plan_id join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id join public.states s on s.id=c.state_id left join public.venues v on v.id=p.current_venue_id
  where sm.author_user_id=v_user_id and sm.state='published' and sm.published_at is not null
    and (p_after_published_at is null or (sm.published_at,sm.id)<(p_after_published_at,p_after_id))
  order by sm.published_at desc,sm.id desc limit v_limit;
end;$function$;

alter function public.get_my_profile_signal_moments_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_profile_signal_moments_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_profile_signal_moments_page(timestamptz,uuid,integer) to authenticated;

create or replace function public.get_signal_public_profile_moments_page(
  p_user_id uuid,p_after_published_at timestamptz default null,p_after_id uuid default null,p_limit integer default 12
)
returns table(moment_id uuid,plan_id uuid,caption text,published_at timestamptz,activity_name text,city_name text,state_code text,venue_name text,signal_count integer,comment_count integer,media jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_viewer uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,12),1),24);
begin
  if v_viewer is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_user_id is null or public.users_have_block_relation(v_viewer,p_user_id) then raise exception 'profile_unavailable' using errcode='42501'; end if;
  if (p_after_published_at is null) <> (p_after_id is null) then raise exception 'invalid_profile_moment_cursor' using errcode='22023'; end if;
  return query
  select sm.id,sm.plan_id,sm.caption,sm.published_at,a.name,c.name,s.code,nullif(btrim(v.name),''),
    (select count(*)::integer from public.signal_moment_signals sms where sms.moment_id=sm.id),
    (select count(*)::integer from public.signal_moment_comments cm where cm.moment_id=sm.id and cm.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('storagePath',mm.storage_path,'mediaKind',mm.media_kind,'mimeType',mm.mime_type) order by mm.sort_order,mm.id) from public.signal_moment_media mm where mm.moment_id=sm.id),'[]'::jsonb)
  from public.signal_moments sm join public.plans p on p.id=sm.plan_id join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id join public.states s on s.id=c.state_id left join public.venues v on v.id=p.current_venue_id
  where sm.author_user_id=p_user_id and sm.state='published' and sm.published_at is not null
    and (p_after_published_at is null or (sm.published_at,sm.id)<(p_after_published_at,p_after_id))
  order by sm.published_at desc,sm.id desc limit v_limit;
end;$function$;

alter function public.get_signal_public_profile_moments_page(uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_signal_public_profile_moments_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_signal_public_profile_moments_page(uuid,timestamptz,uuid,integer) to authenticated;

revoke execute on function public.get_my_profile_signal_moments(integer) from authenticated;
revoke execute on function public.get_signal_public_profile_moments(uuid,integer) from authenticated;

comment on function public.get_my_profile_signal_moments_page(timestamptz,uuid,integer) is 'Cursor-paginated authenticated Signal Life history, bounded for profile media loading.';
comment on function public.get_signal_public_profile_moments_page(uuid,timestamptz,uuid,integer) is 'Cursor-paginated published Signal Life history for a visible authenticated profile.';

commit;
