begin;

-- A checked-in member explicitly choosing to capture a Moment is publication
-- intent. Publish immediately to Activity instead of hiding the media as a
-- draft until the whole Plan reaches its scheduled completion boundary.
create or replace function public.capture_my_signal_moment(
  p_plan_id uuid,
  p_caption text,
  p_media jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_moment_id uuid;
  v_existing_count integer:=0;
  v_new_count integer:=0;
  v_item jsonb;
  v_path text;
  v_kind text;
  v_mime text;
  v_next_order integer;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_plan_id is null then raise exception 'plan_id_required' using errcode='22023'; end if;
  if p_caption is not null and char_length(trim(p_caption))>500 then
    raise exception 'moment_caption_too_long' using errcode='22023';
  end if;
  if jsonb_typeof(p_media)<>'array' or jsonb_array_length(p_media)<1 then
    raise exception 'moment_media_count_invalid' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.id=p_plan_id and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
      and p.state in ('locked','recovery_required','active_outing')
      and exists (
        select 1 from public.attendance_records ar
        where ar.plan_id=p.id and ar.user_id=v_user_id
          and ar.evidence_type='self_reported'::public.attendance_evidence_type
      )
  ) then raise exception 'active_signal_check_in_required' using errcode='42501'; end if;

  select sm.id into v_moment_id
  from public.signal_moments sm
  where sm.plan_id=p_plan_id and sm.author_user_id=v_user_id and sm.state<>'deleted'
  for update;

  if v_moment_id is null then
    insert into public.signal_moments(plan_id,author_user_id,caption,state,published_at,created_at,updated_at)
    values(p_plan_id,v_user_id,nullif(trim(p_caption),''),'draft',clock_timestamp(),clock_timestamp(),clock_timestamp())
    returning id into v_moment_id;
  elsif exists (select 1 from public.signal_moments where id=v_moment_id and state not in ('draft','published')) then
    raise exception 'signal_moment_not_editable' using errcode='P0001';
  else
    update public.signal_moments
    set caption=coalesce(nullif(trim(p_caption),''),caption),updated_at=clock_timestamp()
    where id=v_moment_id;
  end if;

  select count(*)::integer into v_existing_count
  from public.signal_moment_media smm where smm.moment_id=v_moment_id;

  for v_item in select value from jsonb_array_elements(p_media)
  loop
    v_path:=v_item->>'storagePath'; v_kind:=v_item->>'mediaKind'; v_mime:=v_item->>'mimeType';
    if v_path is null or v_kind not in ('image','video') or v_mime is null then
      raise exception 'invalid_moment_media_item' using errcode='22023';
    end if;
    if split_part(v_path,'/',1)<>v_user_id::text or split_part(v_path,'/',2)<>p_plan_id::text then
      raise exception 'moment_media_path_not_owned' using errcode='42501';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='signal-moments' and o.name=v_path) then
      raise exception 'moment_media_object_missing' using errcode='P0001';
    end if;
    if exists(select 1 from public.signal_moment_media smm where smm.moment_id=v_moment_id and smm.storage_path=v_path) then continue; end if;
    v_new_count:=v_new_count+1;
    if v_existing_count+v_new_count>6 then raise exception 'moment_media_count_invalid' using errcode='22023'; end if;
    select coalesce(max(smm.sort_order),-1)+1 into v_next_order from public.signal_moment_media smm where smm.moment_id=v_moment_id;
    insert into public.signal_moment_media(moment_id,storage_path,media_kind,mime_type,sort_order)
    values(v_moment_id,v_path,v_kind,v_mime,v_next_order);
  end loop;

  update public.signal_moments
  set state='published',published_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_moment_id;

  return v_moment_id;
end;
$function$;

alter function public.capture_my_signal_moment(uuid,text,jsonb) owner to postgres;
revoke all on function public.capture_my_signal_moment(uuid,text,jsonb) from public,anon;
grant execute on function public.capture_my_signal_moment(uuid,text,jsonb) to authenticated;

-- Feed visibility follows Moment publication, not Plan completion. This lets
-- live checked-in captures appear immediately while preserving block filtering.
create or replace function public.get_signal_moments_page(
  p_after_is_local boolean default null,
  p_after_published_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns table (
  moment_id uuid,plan_id uuid,caption text,published_at timestamptz,
  author_user_id uuid,author_display_name text,author_avatar_path text,
  activity_name text,city_name text,state_code text,participant_count integer,
  is_local boolean,media jsonb
)
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
      a.name activity_name,c.name city_name,s.code state_code,
      (select count(*)::integer from public.plan_memberships pm
       where pm.plan_id=p.id and pm.membership_state in ('active','completed')) participant_count,
      coalesce(p.city_id=v_home_city_id,false) is_local,
      coalesce((select jsonb_agg(jsonb_build_object(
        'storagePath',smm.storage_path,'mediaKind',smm.media_kind,'mimeType',smm.mime_type
      ) order by smm.sort_order) from public.signal_moment_media smm where smm.moment_id=sm.id),'[]'::jsonb) media
    from public.signal_moments sm
    join public.plans p on p.id=sm.plan_id
    join public.activities a on a.id=p.activity_id
    join public.cities c on c.id=p.city_id
    join public.states s on s.id=c.state_id
    join public.user_profiles up on up.user_id=sm.author_user_id
    where sm.state='published'
      and not public.users_have_block_relation(v_user_id,sm.author_user_id)
  )
  select r.moment_id,r.plan_id,r.caption,r.published_at,r.author_user_id,
    r.author_display_name,r.author_avatar_path,r.activity_name,r.city_name,r.state_code,
    r.participant_count,r.is_local,r.media
  from ranked r
  where p_after_is_local is null
     or (r.is_local,r.published_at,r.moment_id)<(p_after_is_local,p_after_published_at,p_after_id)
  order by r.is_local desc,r.published_at desc,r.moment_id desc
  limit p_limit;
end;
$function$;

alter function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer) to authenticated;

-- Repair captures made under the old delayed-publication contract. They already
-- have media and explicit captions/uploads from checked-in members.
update public.signal_moments sm
set state='published',published_at=clock_timestamp(),updated_at=clock_timestamp()
where sm.state='draft'
  and exists(select 1 from public.signal_moment_media smm where smm.moment_id=sm.id)
  and exists(
    select 1 from public.attendance_records ar
    where ar.plan_id=sm.plan_id and ar.user_id=sm.author_user_id
      and ar.evidence_type='self_reported'::public.attendance_evidence_type
  );

comment on function public.capture_my_signal_moment(uuid,text,jsonb)
is 'Publishes checked-in member photo/video capture immediately to SIGNAL Moments; repeat media paths remain idempotent and one member Moment may accumulate up to six items.';
comment on function public.get_signal_moments_page(boolean,timestamptz,uuid,integer)
is 'Returns published Signal Moments immediately, including captures from an outing still live, local first and block-safe.';

commit;
