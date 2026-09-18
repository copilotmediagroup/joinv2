begin;

create table if not exists public.signal_moment_signals (
  moment_id uuid not null references public.signal_moments(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key(moment_id,user_id)
);

create table if not exists public.signal_moment_comments (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.signal_moments(id) on delete cascade,
  author_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  parent_comment_id uuid null references public.signal_moment_comments(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz null,
  constraint signal_moment_comment_body_check check(char_length(btrim(body)) between 1 and 1000)
);
create index if not exists signal_moment_comments_moment_idx
on public.signal_moment_comments(moment_id,created_at,id);
create index if not exists signal_moment_comments_parent_idx
on public.signal_moment_comments(parent_comment_id,created_at,id);

alter table public.signal_moment_signals enable row level security;
alter table public.signal_moment_comments enable row level security;
revoke all on table public.signal_moment_signals from public,anon,authenticated;
revoke all on table public.signal_moment_comments from public,anon,authenticated;
grant all on table public.signal_moment_signals to service_role;
grant all on table public.signal_moment_comments to service_role;

create or replace function public.toggle_signal_moment_signal(p_moment_id uuid)
returns table(signaled boolean,signal_count integer)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
 if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if not exists(select 1 from public.signal_moments sm where sm.id=p_moment_id and sm.state='published')
 then raise exception 'published_moment_required' using errcode='P0001'; end if;
 if public.users_have_block_relation(v_user_id,(select sm.author_user_id from public.signal_moments sm where sm.id=p_moment_id))
 then raise exception 'moment_unavailable' using errcode='42501'; end if;

 if exists(select 1 from public.signal_moment_signals s where s.moment_id=p_moment_id and s.user_id=v_user_id) then
   delete from public.signal_moment_signals s where s.moment_id=p_moment_id and s.user_id=v_user_id;
   signaled:=false;
 else
   insert into public.signal_moment_signals(moment_id,user_id) values(p_moment_id,v_user_id);
   signaled:=true;
 end if;
 select count(*)::integer into signal_count from public.signal_moment_signals s where s.moment_id=p_moment_id;
 return next;
end;$function$;

revoke all on function public.toggle_signal_moment_signal(uuid) from public,anon;
grant execute on function public.toggle_signal_moment_signal(uuid) to authenticated;

create or replace function public.add_signal_moment_comment(
 p_moment_id uuid,p_body text,p_parent_comment_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_id uuid; v_author uuid;
begin
 if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_body is null or char_length(btrim(p_body)) not between 1 and 1000
 then raise exception 'comment_body_invalid' using errcode='22023'; end if;
 select sm.author_user_id into v_author from public.signal_moments sm
 where sm.id=p_moment_id and sm.state='published';
 if v_author is null or public.users_have_block_relation(v_user_id,v_author)
 then raise exception 'moment_unavailable' using errcode='42501'; end if;
 if p_parent_comment_id is not null and not exists(
   select 1 from public.signal_moment_comments c
   where c.id=p_parent_comment_id and c.moment_id=p_moment_id and c.parent_comment_id is null and c.deleted_at is null
 ) then raise exception 'reply_parent_invalid' using errcode='22023'; end if;
 insert into public.signal_moment_comments(moment_id,author_user_id,parent_comment_id,body)
 values(p_moment_id,v_user_id,p_parent_comment_id,btrim(p_body)) returning id into v_id;
 return v_id;
end;$function$;

revoke all on function public.add_signal_moment_comment(uuid,text,uuid) from public,anon;
grant execute on function public.add_signal_moment_comment(uuid,text,uuid) to authenticated;

create or replace function public.delete_my_signal_moment_comment(p_comment_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
 if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
 update public.signal_moment_comments c
 set deleted_at=clock_timestamp(),body='',updated_at=clock_timestamp()
 where c.id=p_comment_id and c.author_user_id=v_user_id and c.deleted_at is null;
 return found;
end;$function$;
revoke all on function public.delete_my_signal_moment_comment(uuid) from public,anon;
grant execute on function public.delete_my_signal_moment_comment(uuid) to authenticated;

create or replace function public.get_signal_moment_comments(p_moment_id uuid)
returns table(comment_id uuid,parent_comment_id uuid,author_user_id uuid,author_display_name text,
 author_avatar_path text,body text,created_at timestamptz,is_mine boolean)
language sql stable security definer set search_path=public,pg_temp
as $$
 select c.id,c.parent_comment_id,c.author_user_id,coalesce(up.display_name,'SIGNAL member'),
   up.avatar_path,c.body,c.created_at,c.author_user_id=auth.uid()
 from public.signal_moment_comments c join public.user_profiles up on up.user_id=c.author_user_id
 join public.signal_moments sm on sm.id=c.moment_id
 where c.moment_id=p_moment_id and c.deleted_at is null and sm.state='published'
   and not public.users_have_block_relation(auth.uid(),c.author_user_id)
   and not public.users_have_block_relation(auth.uid(),sm.author_user_id)
 order by coalesce(c.parent_comment_id,c.id),case when c.parent_comment_id is null then 0 else 1 end,c.created_at,c.id;
$$;
revoke all on function public.get_signal_moment_comments(uuid) from public,anon;
grant execute on function public.get_signal_moment_comments(uuid) to authenticated;

drop function if exists public.get_signal_moments_page(boolean,timestamptz,uuid,integer);
create function public.get_signal_moments_page(
 p_after_is_local boolean default null,p_after_published_at timestamptz default null,
 p_after_id uuid default null,p_limit integer default 20
) returns table(moment_id uuid,plan_id uuid,caption text,published_at timestamptz,
 author_user_id uuid,author_display_name text,author_avatar_path text,activity_name text,
 city_name text,state_code text,venue_name text,participant_count integer,is_local boolean,
 signal_count integer,comment_count integer,did_signal boolean,media jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_home_city_id uuid;
begin
 if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid_moment_limit' using errcode='22023'; end if;
 if not ((p_after_is_local is null and p_after_published_at is null and p_after_id is null)
 or (p_after_is_local is not null and p_after_published_at is not null and p_after_id is not null))
 then raise exception 'invalid_moment_cursor' using errcode='22023'; end if;
 select up.home_city_id into v_home_city_id from public.user_profiles up where up.user_id=v_user_id;
 return query
 with ranked as (
 select sm.id moment_id,sm.plan_id,sm.caption,sm.published_at,sm.author_user_id,
 coalesce(up.display_name,'SIGNAL member') author_display_name,up.avatar_path author_avatar_path,
 a.name activity_name,c.name city_name,s.code state_code,nullif(btrim(p.current_venue_name),'') venue_name,
 (select count(*)::integer from public.plan_memberships pm where pm.plan_id=p.id and pm.membership_state in ('active','completed')) participant_count,
 coalesce(p.city_id=v_home_city_id,false) is_local,
 (select count(*)::integer from public.signal_moment_signals ms where ms.moment_id=sm.id) signal_count,
 (select count(*)::integer from public.signal_moment_comments mc where mc.moment_id=sm.id and mc.deleted_at is null) comment_count,
 exists(select 1 from public.signal_moment_signals mine where mine.moment_id=sm.id and mine.user_id=v_user_id) did_signal,
 coalesce((select jsonb_agg(jsonb_build_object('storagePath',smm.storage_path,'mediaKind',smm.media_kind,'mimeType',smm.mime_type) order by smm.sort_order)
 from public.signal_moment_media smm where smm.moment_id=sm.id),'[]'::jsonb) media

 from public.signal_moments sm join public.plans p on p.id=sm.plan_id
 join public.activities a on a.id=p.activity_id join public.cities c on c.id=p.city_id
 join public.states s on s.id=c.state_id join public.user_profiles up on up.user_id=sm.author_user_id
 where sm.state='published' and not public.users_have_block_relation(v_user_id,sm.author_user_id)
 )
 select r.moment_id,r.plan_id,r.caption,r.published_at,r.author_user_id,r.author_display_name,
 r.author_avatar_path,r.activity_name,r.city_name,r.state_code,r.venue_name,r.participant_count,
 r.is_local,r.signal_count,r.comment_count,r.did_signal,r.media
 from ranked r
 where p_after_is_local is null or (r.is_local,r.published_at,r.moment_id)<(p_after_is_local,p_after_published_at,p_after_id)
 order by r.is_local desc,r.published_at desc,r.moment_id desc limit p_limit;
end;$function$;
alter function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) to authenticated;

comment on table public.signal_moment_signals is 'Branded SIGNAL reactions to published Moments; distinct from meetup Signal lifecycle.';
comment on table public.signal_moment_comments is 'Threaded comments for published Signal Moments. Replies are one level deep.';
commit;
