begin;

create or replace function public.get_signal_moments(
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
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with caller as (
    select up.home_city_id
    from public.user_profiles up
    where up.user_id=auth.uid()
  )
  select
    sm.id,
    sm.plan_id,
    sm.caption,
    sm.published_at,
    sm.author_user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    a.name,
    c.name,
    s.code,
    (
      select count(*)::integer
      from public.plan_memberships pm
      where pm.plan_id=p.id
        and pm.membership_state='active'::public.plan_membership_state
    ),
    p.city_id=(select home_city_id from caller),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'storagePath',smm.storage_path,
            'mediaKind',smm.media_kind,
            'mimeType',smm.mime_type
          ) order by smm.sort_order
        )
        from public.signal_moment_media smm
        where smm.moment_id=sm.id
      ),
      '[]'::jsonb
    )
  from public.signal_moments sm
  join public.plans p on p.id=sm.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  join public.user_profiles up on up.user_id=sm.author_user_id
  where auth.uid() is not null
    and sm.state='published'
    and p.state='completed'::public.plan_state
    and not public.users_have_block_relation(auth.uid(),sm.author_user_id)
  order by
    (p.city_id=(select home_city_id from caller)) desc,
    sm.published_at desc,
    sm.id desc
  limit greatest(1,least(coalesce(p_limit,20),50));
$$;

alter function public.get_signal_moments(integer) owner to postgres;
revoke all on function public.get_signal_moments(integer) from public,anon;
grant execute on function public.get_signal_moments(integer) to authenticated;

commit;
