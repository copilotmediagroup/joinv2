begin;

create or replace function public.publish_my_signal_moment(
  p_plan_id uuid,
  p_caption text,
  p_media jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_moment_id uuid;
  v_existing_caption text;
  v_existing_media jsonb;
  v_media_count integer;
  v_item jsonb;
  v_path text;
  v_kind text;
  v_mime text;
  v_order integer:=0;
  v_normalized_caption text:=nullif(trim(p_caption),'');
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
  end if;

  if not exists (
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

  if (
    select count(distinct item->>'storagePath')
    from jsonb_array_elements(p_media) item
  ) <> v_media_count then
    raise exception 'duplicate_moment_media_path' using errcode='22023';
  end if;

  select sm.id,sm.caption,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'storagePath',smm.storage_path,
               'mediaKind',smm.media_kind,
               'mimeType',smm.mime_type
             ) order by smm.sort_order
           ) filter (where smm.id is not null),
           '[]'::jsonb
         )
  into v_moment_id,v_existing_caption,v_existing_media
  from public.signal_moments sm
  left join public.signal_moment_media smm on smm.moment_id=sm.id
  where sm.plan_id=p_plan_id
    and sm.author_user_id=v_user_id
    and sm.state<>'deleted'
  group by sm.id,sm.caption;

  if v_moment_id is not null then
    if v_existing_caption is not distinct from v_normalized_caption
       and v_existing_media = p_media then
      return v_moment_id;
    end if;
    raise exception 'moment_already_published' using errcode='23505';
  end if;

  insert into public.signal_moments(
    plan_id,author_user_id,caption,state,published_at
  ) values (
    p_plan_id,v_user_id,v_normalized_caption,'published',clock_timestamp()
  ) returning id into v_moment_id;

  for v_item in
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
      select 1 from storage.objects o
      where o.bucket_id='signal-moments' and o.name=v_path
    ) then
      raise exception 'moment_media_object_missing' using errcode='P0001';
    end if;

    insert into public.signal_moment_media(
      moment_id,storage_path,media_kind,mime_type,sort_order
    ) values (
      v_moment_id,v_path,v_kind,v_mime,v_order
    );

    v_order:=v_order+1;
  end loop;

  return v_moment_id;
end;
$function$;

alter function public.publish_my_signal_moment(uuid,text,jsonb) owner to postgres;
revoke all on function public.publish_my_signal_moment(uuid,text,jsonb) from public,anon;
grant execute on function public.publish_my_signal_moment(uuid,text,jsonb) to authenticated;

comment on function public.publish_my_signal_moment(uuid,text,jsonb)
is 'Idempotent Moment publish for one member/Plan. Exact transport retries return the existing Moment ID; conflicting payloads remain rejected.';

commit;
