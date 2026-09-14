begin;

create or replace function public.get_signal_moments_page(
  p_after_is_local boolean default null,
  p_after_published_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns table (
  moment_id uuid,
  plan_id uuid,
  caption text,
  published_at timestamptz,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  activity_name text,
  city_name text,
  state_code text,
  participant_count integer,
  is_local boolean,
  media jsonb
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_home_city_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'invalid_moment_limit' using errcode='22023';
  end if;
  if not (
    (p_after_is_local is null and p_after_published_at is null and p_after_id is null)
    or
    (p_after_is_local is not null and p_after_published_at is not null and p_after_id is not null)
  ) then
    raise exception 'invalid_moment_cursor' using errcode='22023';
  end if;

  select up.home_city_id into v_home_city_id
  from public.user_profiles up
  where up.user_id=v_user_id;

  return query
  with ranked as (
    select
      sm.id as moment_id,
      sm.plan_id,
      sm.caption,
      sm.published_at,
      sm.author_user_id,
      coalesce(up.display_name,'SIGNAL member') as author_display_name,
      up.avatar_path as author_avatar_path,
      a.name as activity_name,
      c.name as city_name,
      s.code as state_code,
      (select count(*)::integer
         from public.plan_memberships pm
        where pm.plan_id=p.id
          and pm.membership_state='active'::public.plan_membership_state) as participant_count,
      (p.city_id=v_home_city_id) as is_local,
      coalesce(
        (select jsonb_agg(
           jsonb_build_object(
             'storagePath',smm.storage_path,
             'mediaKind',smm.media_kind,
             'mimeType',smm.mime_type
           ) order by smm.sort_order)
         from public.signal_moment_media smm
         where smm.moment_id=sm.id),
        '[]'::jsonb
      ) as media
    from public.signal_moments sm
    join public.plans p on p.id=sm.plan_id
    join public.activities a on a.id=p.activity_id
    join public.cities c on c.id=p.city_id
    join public.states s on s.id=c.state_id
    join public.user_profiles up on up.user_id=sm.author_user_id
    where sm.state='published'
      and p.state='completed'::public.plan_state
      and not public.users_have_block_relation(v_user_id,sm.author_user_id)
  )
  select
    r.moment_id,
    r.plan_id,
    r.caption,
    r.published_at,
    r.author_user_id,
    r.author_display_name,
    r.author_avatar_path,
    r.activity_name,
    r.city_name,
    r.state_code,
    r.participant_count,
    r.is_local,
    r.media
  from ranked r
  where p_after_is_local is null
     or (r.is_local,r.published_at,r.moment_id)
        < (p_after_is_local,p_after_published_at,p_after_id)
  order by r.is_local desc,r.published_at desc,r.moment_id desc
  limit p_limit;
end;
$function$;
alter function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) to authenticated;

comment on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer)
is 'Returns a bounded cursor page of published Signal Moments, local first, while respecting reciprocal blocks.';

commit;
