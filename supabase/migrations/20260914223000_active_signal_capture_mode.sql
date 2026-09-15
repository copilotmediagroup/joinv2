begin;

alter table public.signal_moments
  drop constraint if exists signal_moments_state_check;

alter table public.signal_moments
  add constraint signal_moments_state_check
  check (state in ('draft','published','hidden','deleted'));

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
      and pm.user_id=auth.uid()
      and pm.membership_state='active'::public.plan_membership_state
      and p.state in ('locked','recovery_required','active_outing')
      and exists (
        select 1 from public.attendance_records ar
        where ar.plan_id=p.id
          and ar.user_id=auth.uid()
          and ar.evidence_type='self_reported'::public.attendance_evidence_type
      )
  );
$$;alter function public.can_upload_signal_moment_object(text) owner to postgres;
revoke all on function public.can_upload_signal_moment_object(text) from public,anon;
grant execute on function public.can_upload_signal_moment_object(text) to authenticated;

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
      and (
        sm.author_user_id=auth.uid()
        or sm.state='published'
      )
  );
$$;

alter function public.can_read_signal_moment_object(text) owner to postgres;
revoke all on function public.can_read_signal_moment_object(text) from public,anon;
grant execute on function public.can_read_signal_moment_object(text) to authenticated;

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
begin  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if p_plan_id is null then
    raise exception 'plan_id_required' using errcode='22023';
  end if;
  if p_caption is not null and char_length(trim(p_caption))>500 then
    raise exception 'moment_caption_too_long' using errcode='22023';
  end if;
  if jsonb_typeof(p_media)<>'array' then
    raise exception 'moment_media_must_be_array' using errcode='22023';
  end if;
  if jsonb_array_length(p_media)<1 then
    raise exception 'moment_media_count_invalid' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.id=p_plan_id
      and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
      and p.state in ('locked','recovery_required','active_outing')
      and exists (
        select 1 from public.attendance_records ar
        where ar.plan_id=p.id
          and ar.user_id=v_user_id
          and ar.evidence_type='self_reported'::public.attendance_evidence_type
      )
  ) then
    raise exception 'active_signal_check_in_required' using errcode='42501';
  end if;
  select sm.id into v_moment_id
  from public.signal_moments sm
  where sm.plan_id=p_plan_id
    and sm.author_user_id=v_user_id
    and sm.state<>'deleted'
  for update;

  if v_moment_id is null then
    insert into public.signal_moments(
      plan_id,author_user_id,caption,state,published_at,created_at,updated_at
    ) values (
      p_plan_id,v_user_id,nullif(trim(p_caption),''),'draft',clock_timestamp(),clock_timestamp(),clock_timestamp()
    )
    returning id into v_moment_id;
  else
    update public.signal_moments
    set caption=coalesce(nullif(trim(p_caption),''),caption),
        updated_at=clock_timestamp()
    where id=v_moment_id
      and state='draft';

    if not found then
      raise exception 'signal_moment_not_editable' using errcode='P0001';
    end if;
  end if;

  select count(*)::integer into v_existing_count
  from public.signal_moment_media smm
  where smm.moment_id=v_moment_id;

  for v_item in select value from jsonb_array_elements(p_media)
  loop    v_path:=v_item->>'storagePath';
    v_kind:=v_item->>'mediaKind';
    v_mime:=v_item->>'mimeType';

    if v_path is null or v_kind not in ('image','video') or v_mime is null then
      raise exception 'invalid_moment_media_item' using errcode='22023';
    end if;
    if split_part(v_path,'/',1)<>v_user_id::text
       or split_part(v_path,'/',2)<>p_plan_id::text then
      raise exception 'moment_media_path_not_owned' using errcode='42501';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id='signal-moments'
        and o.name=v_path
    ) then
      raise exception 'moment_media_object_missing' using errcode='P0001';
    end if;

    if exists (
      select 1 from public.signal_moment_media smm
      where smm.moment_id=v_moment_id
        and smm.storage_path=v_path
    ) then
      continue;
    end if;

    v_new_count:=v_new_count+1;
    if v_existing_count+v_new_count>6 then
      raise exception 'moment_media_count_invalid' using errcode='22023';
    end if;

    select coalesce(max(smm.sort_order),-1)+1 into v_next_order
    from public.signal_moment_media smm
    where smm.moment_id=v_moment_id;
    insert into public.signal_moment_media(
      moment_id,storage_path,media_kind,mime_type,sort_order
    ) values (
      v_moment_id,v_path,v_kind,v_mime,v_next_order
    );
  end loop;

  return v_moment_id;
end;
$function$;

alter function public.capture_my_signal_moment(uuid,text,jsonb) owner to postgres;
revoke all on function public.capture_my_signal_moment(uuid,text,jsonb) from public,anon;
grant execute on function public.capture_my_signal_moment(uuid,text,jsonb) to authenticated;

create or replace function public.publish_live_signal_moment_on_plan_completion()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  if new.state='completed'::public.plan_state
     and old.state is distinct from new.state then
    update public.signal_moments sm
    set state='published',
        published_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where sm.plan_id=new.id
      and sm.state='draft'
      and exists (
        select 1 from public.signal_moment_media smm
        where smm.moment_id=sm.id
      );
  end if;
  return new;
end;
$function$;
alter function public.publish_live_signal_moment_on_plan_completion() owner to postgres;
revoke all on function public.publish_live_signal_moment_on_plan_completion() from public,anon,authenticated;

drop trigger if exists publish_live_signal_moment_on_plan_completion on public.plans;
create trigger publish_live_signal_moment_on_plan_completion
after update of state on public.plans
for each row
execute function public.publish_live_signal_moment_on_plan_completion();

create or replace function public.publish_my_signal_moment(
  p_plan_id uuid,
  p_caption text,
  p_media jsonb
)
returns uuid
language sql
security definer
set search_path=public,pg_temp
as $$
  select public.capture_my_signal_moment(p_plan_id,p_caption,p_media);
$$;

alter function public.publish_my_signal_moment(uuid,text,jsonb) owner to postgres;
revoke all on function public.publish_my_signal_moment(uuid,text,jsonb) from public,anon;
grant execute on function public.publish_my_signal_moment(uuid,text,jsonb) to authenticated;

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
as $$  select
    p.id,a.name,c.name,s.code,p.scheduled_starts_at,p.completed_at
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  where pm.user_id=auth.uid()
    and pm.membership_state='active'::public.plan_membership_state
    and p.state in ('locked','recovery_required','active_outing')
    and exists (
      select 1 from public.attendance_records ar
      where ar.plan_id=p.id
        and ar.user_id=auth.uid()
        and ar.evidence_type='self_reported'::public.attendance_evidence_type
    )
  order by p.scheduled_starts_at desc nulls last,p.id
  limit 4;
$$;

alter function public.get_my_signal_moment_eligible_plans() owner to postgres;
revoke all on function public.get_my_signal_moment_eligible_plans() from public,anon;
grant execute on function public.get_my_signal_moment_eligible_plans() to authenticated;

comment on function public.capture_my_signal_moment(uuid,text,jsonb)
is 'Adds checked-in member media to one private draft Signal Moment while the Plan is live. Repeat storage paths are idempotent; public feed publication waits for Plan completion.';

comment on function public.get_my_signal_moment_eligible_plans()
is 'Returns checked-in live Signal Plans that still accept Moment capture. Completed Plans are intentionally excluded.';

commit;