begin;

insert into storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
)
values (
  'signal-moments','signal-moments',false,104857600,
  array[
    'image/jpeg','image/png','image/webp',
    'video/mp4','video/webm','video/quicktime'
  ]::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.signal_moments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  caption text null,
  state text not null default 'published',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),  constraint signal_moments_state_check
    check (state in ('published','hidden','deleted')),
  constraint signal_moments_caption_length_check
    check (caption is null or char_length(caption) <= 500),
  constraint signal_moments_one_per_member_per_plan
    unique (plan_id,author_user_id)
);

create table if not exists public.signal_moment_media (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.signal_moments(id) on delete cascade,
  storage_path text not null unique,
  media_kind text not null,
  mime_type text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint signal_moment_media_kind_check
    check (media_kind in ('image','video')),
  constraint signal_moment_media_sort_check
    check (sort_order between 0 and 5),
  constraint signal_moment_media_unique_order
    unique (moment_id,sort_order)
);

create index if not exists signal_moments_feed_idx
  on public.signal_moments(state,published_at desc,id);

create index if not exists signal_moments_plan_idx
  on public.signal_moments(plan_id,published_at desc);alter table public.signal_moments enable row level security;
alter table public.signal_moment_media enable row level security;

revoke all on table public.signal_moments from public,anon,authenticated;
revoke all on table public.signal_moment_media from public,anon,authenticated;

grant select on table public.signal_moments to service_role;
grant select on table public.signal_moment_media to service_role;

create or replace function public.can_upload_signal_moment_object(
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where auth.uid() is not null
      and split_part(p_name,'/',1)=auth.uid()::text
      and split_part(p_name,'/',2)=p.id::text
      and p.state='completed'::public.plan_state
      and pm.user_id=auth.uid()
      and pm.membership_state='active'::public.plan_membership_state
  );
$$;alter function public.can_upload_signal_moment_object(text) owner to postgres;
revoke all on function public.can_upload_signal_moment_object(text)
from public,anon;
grant execute on function public.can_upload_signal_moment_object(text)
to authenticated;

create or replace function public.can_read_signal_moment_object(
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.signal_moment_media smm
    join public.signal_moments sm on sm.id=smm.moment_id
    where auth.uid() is not null
      and smm.storage_path=p_name
      and sm.state='published'
  );
$$;

alter function public.can_read_signal_moment_object(text) owner to postgres;
revoke all on function public.can_read_signal_moment_object(text)
from public,anon;
grant execute on function public.can_read_signal_moment_object(text)
to authenticated;drop policy if exists signal_moments_upload_insert on storage.objects;
create policy signal_moments_upload_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id='signal-moments'
  and public.can_upload_signal_moment_object(name)
);

drop policy if exists signal_moments_published_read on storage.objects;
create policy signal_moments_published_read
on storage.objects
for select
to authenticated
using (
  bucket_id='signal-moments'
  and public.can_read_signal_moment_object(name)
);

drop policy if exists signal_moments_owner_delete on storage.objects;
create policy signal_moments_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id='signal-moments'
  and split_part(name,'/',1)=auth.uid()::text
);

create or replace function public.publish_my_signal_moment(
  p_plan_id uuid,
  p_caption text,
  p_media jsonb
)returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_moment_id uuid;
  v_media_count integer;
  v_item jsonb;
  v_path text;
  v_kind text;
  v_mime text;
  v_order integer:=0;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_caption is not null and char_length(trim(p_caption))>500 then
    raise exception 'moment_caption_too_long' using errcode='22023';
  end if;

  if jsonb_typeof(p_media) <> 'array' then
    raise exception 'moment_media_must_be_array' using errcode='22023';
  end if;

  v_media_count:=jsonb_array_length(p_media);
  if v_media_count < 1 or v_media_count > 6 then
    raise exception 'moment_media_count_invalid' using errcode='22023';
  end if;  if not exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.id=p_plan_id
      and p.state='completed'::public.plan_state
      and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
  ) then
    raise exception 'completed_plan_membership_required' using errcode='42501';
  end if;

  if exists (
    select 1 from public.signal_moments sm
    where sm.plan_id=p_plan_id
      and sm.author_user_id=v_user_id
      and sm.state <> 'deleted'
  ) then
    raise exception 'moment_already_published' using errcode='23505';
  end if;

  if (
    select count(distinct item->>'storagePath')
    from jsonb_array_elements(p_media) item
  ) <> v_media_count then
    raise exception 'duplicate_moment_media_path' using errcode='22023';
  end if;

  insert into public.signal_moments(
    plan_id,author_user_id,caption,state,published_at
  ) values (
    p_plan_id,v_user_id,nullif(trim(p_caption),''),'published',clock_timestamp()
  ) returning id into v_moment_id;  for v_item in
    select value from jsonb_array_elements(p_media)
  loop
    v_path:=v_item->>'storagePath';
    v_kind:=v_item->>'mediaKind';
    v_mime:=v_item->>'mimeType';

    if v_path is null or v_kind not in ('image','video') or v_mime is null then
      raise exception 'invalid_moment_media_item' using errcode='22023';
    end if;

    if split_part(v_path,'/',1) <> v_user_id::text
       or split_part(v_path,'/',2) <> p_plan_id::text then
      raise exception 'moment_media_path_not_owned' using errcode='42501';
    end if;

    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id='signal-moments'
        and o.name=v_path
    ) then
      raise exception 'moment_media_object_missing' using errcode='P0001';
    end if;

    insert into public.signal_moment_media(
      moment_id,storage_path,media_kind,mime_type,sort_order
    ) values (
      v_moment_id,v_path,v_kind,v_mime,v_order
    );

    v_order:=v_order+1;
  end loop;  return v_moment_id;
end;
$function$;

alter function public.publish_my_signal_moment(uuid,text,jsonb) owner to postgres;
revoke all on function public.publish_my_signal_moment(uuid,text,jsonb)
from public,anon;
grant execute on function public.publish_my_signal_moment(uuid,text,jsonb)
to authenticated;

create or replace function public.get_my_signal_moment_eligible_plans()
returns table (
  plan_id uuid,
  activity_name text,
  city_name text,
  state_code text,
  scheduled_starts_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    p.id,a.name,c.name,s.code,p.scheduled_starts_at,p.completed_at
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  where pm.user_id=auth.uid()    and pm.membership_state='active'::public.plan_membership_state
    and p.state='completed'::public.plan_state
    and not exists (
      select 1
      from public.signal_moments sm
      where sm.plan_id=p.id
        and sm.author_user_id=auth.uid()
        and sm.state <> 'deleted'
    )
  order by p.completed_at desc nulls last,p.id
  limit 12;
$$;

alter function public.get_my_signal_moment_eligible_plans() owner to postgres;
revoke all on function public.get_my_signal_moment_eligible_plans()
from public,anon;
grant execute on function public.get_my_signal_moment_eligible_plans()
to authenticated;

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
)language sql
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
    )  from public.signal_moments sm
  join public.plans p on p.id=sm.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  join public.user_profiles up on up.user_id=sm.author_user_id
  where auth.uid() is not null
    and sm.state='published'
    and p.state='completed'::public.plan_state
  order by
    (p.city_id=(select home_city_id from caller)) desc,
    sm.published_at desc,
    sm.id desc
  limit greatest(1,least(coalesce(p_limit,20),50));
$$;

alter function public.get_signal_moments(integer) owner to postgres;
revoke all on function public.get_signal_moments(integer)
from public,anon;
grant execute on function public.get_signal_moments(integer)
to authenticated;

commit;