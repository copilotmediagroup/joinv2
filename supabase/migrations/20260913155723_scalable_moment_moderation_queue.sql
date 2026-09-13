alter table public.signal_moment_reports
  add column if not exists assigned_admin_user_id uuid
    references public.user_profiles(user_id) on delete set null,
  add column if not exists claimed_at timestamptz;

create index if not exists signal_moment_reports_open_unassigned_idx
  on public.signal_moment_reports(created_at,id)
  where state='open' and assigned_admin_user_id is null;

create index if not exists signal_moment_reports_admin_work_idx
  on public.signal_moment_reports(assigned_admin_user_id,state,created_at,id)
  where assigned_admin_user_id is not null;

create or replace function public.get_moderation_moment_queue(
  p_state text default null,
  p_assignment text default 'all',
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 40
)
returns table(
  report_id uuid,
  moment_id uuid,
  reporter_user_id uuid,
  reporter_display_name text,
  author_user_id uuid,
  author_display_name text,
  caption text,
  reason text,
  details text,
  state text,
  assigned_admin_user_id uuid,
  claimed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_state is not null and p_state not in ('open','reviewed','dismissed','actioned') then
    raise exception 'invalid_moment_report_state' using errcode='22023';
  end if;
  if p_assignment not in ('all','mine','unassigned') then
    raise exception 'invalid_moderation_assignment' using errcode='22023';
  end if;

  return query
  select smr.id,smr.moment_id,smr.reporter_user_id,
    coalesce(rp.display_name,'SIGNAL member'),
    sm.author_user_id,coalesce(ap.display_name,'SIGNAL member'),
    sm.caption,smr.reason,smr.details,smr.state,
    smr.assigned_admin_user_id,smr.claimed_at,smr.created_at,smr.updated_at
  from public.signal_moment_reports smr
  join public.signal_moments sm on sm.id=smr.moment_id
  join public.user_profiles rp on rp.user_id=smr.reporter_user_id
  join public.user_profiles ap on ap.user_id=sm.author_user_id
  where (p_state is null or smr.state=p_state)
    and (p_assignment='all'
      or (p_assignment='mine' and smr.assigned_admin_user_id=v_admin_user_id)
      or (p_assignment='unassigned' and smr.assigned_admin_user_id is null))
    and (p_after_created_at is null
      or (smr.created_at,smr.id)>(p_after_created_at,p_after_id))
  order by smr.created_at,smr.id
  limit greatest(1,least(coalesce(p_limit,40),100));
end;
$function$;

alter function public.get_moderation_moment_queue(text,text,timestamptz,uuid,integer)
  owner to postgres;
revoke all on function public.get_moderation_moment_queue(text,text,timestamptz,uuid,integer)
  from public,anon;
grant execute on function public.get_moderation_moment_queue(text,text,timestamptz,uuid,integer)
  to authenticated;

create or replace function public.claim_next_moderation_moment()
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_report_id uuid;
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  select smr.id into v_report_id
  from public.signal_moment_reports smr
  where smr.state='open'
    and smr.assigned_admin_user_id is null
  order by smr.created_at,smr.id
  for update skip locked
  limit 1;

  if v_report_id is null then
    return null;
  end if;

  update public.signal_moment_reports
  set state='reviewed',
      assigned_admin_user_id=v_admin_user_id,
      claimed_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=v_report_id;

  return v_report_id;
end;
$function$;
alter function public.claim_next_moderation_moment() owner to postgres;
revoke all on function public.claim_next_moderation_moment() from public,anon;
grant execute on function public.claim_next_moderation_moment() to authenticated;

create or replace function public.release_my_moderation_moment(
  p_report_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  update public.signal_moment_reports
  set state='open',assigned_admin_user_id=null,claimed_at=null,
      updated_at=clock_timestamp()
  where id=p_report_id and state='reviewed'
    and assigned_admin_user_id=v_admin_user_id;
  return found;
end;
$function$;
alter function public.release_my_moderation_moment(uuid) owner to postgres;
revoke all on function public.release_my_moderation_moment(uuid) from public,anon;
grant execute on function public.release_my_moderation_moment(uuid) to authenticated;

create or replace function public.review_moderation_moment(
  p_report_id uuid,
  p_state text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_report public.signal_moment_reports%rowtype;
begin
  if v_admin_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_state not in ('dismissed','actioned') then
    raise exception 'invalid_moment_review_state' using errcode='22023';
  end if;
  if p_note is not null and char_length(p_note)>2000 then
    raise exception 'moderation_note_too_long' using errcode='22023';
  end if;
  select * into v_report
  from public.signal_moment_reports
  where id=p_report_id
  for update;
  if not found then raise exception 'moment_report_not_found' using errcode='P0001'; end if;
  if v_report.assigned_admin_user_id<>v_admin_user_id or v_report.state<>'reviewed' then
    raise exception 'moderation_report_not_owned' using errcode='42501';
  end if;

  update public.signal_moment_reports
  set state=p_state,updated_at=clock_timestamp()
  where id=p_report_id;

  if p_state='actioned' then
    update public.signal_moments
    set state='hidden',updated_at=clock_timestamp()
    where id=v_report.moment_id and state='published';
  end if;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,
    reason,metadata,occurred_at
  ) values (
    v_admin_user_id,'moderation.review','signal_moment_report_'||p_state,
    'signal_moment_reports',p_report_id,nullif(btrim(p_note),''),
    jsonb_build_object('momentId',v_report.moment_id,'reporterUserId',v_report.reporter_user_id),
    clock_timestamp()
  );
  return true;
end;
$function$;

alter function public.review_moderation_moment(uuid,text,text) owner to postgres;
revoke all on function public.review_moderation_moment(uuid,text,text) from public,anon;
grant execute on function public.review_moderation_moment(uuid,text,text) to authenticated;

comment on function public.get_moderation_moment_queue(text,text,timestamptz,uuid,integer)
is 'Bounded cursor-paginated Signal Moment moderation queue.';
comment on function public.claim_next_moderation_moment()
is 'Atomically claims the oldest unassigned open Signal Moment report using SKIP LOCKED.';
comment on function public.release_my_moderation_moment(uuid)
is 'Returns a moderator-owned Signal Moment report to the shared queue.';
comment on function public.review_moderation_moment(uuid,text,text)
is 'Finalizes a moderator-owned Signal Moment report; actioned reports hide the published Moment and audit the action.';
