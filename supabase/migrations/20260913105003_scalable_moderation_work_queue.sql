begin;

alter table public.user_reports
  add column assigned_admin_user_id uuid references public.user_profiles(user_id) on delete set null,
  add column claimed_at timestamptz;

alter table public.user_reports
  add constraint user_reports_open_unassigned_check
  check (
    state <> 'open'
    or (assigned_admin_user_id is null and claimed_at is null)
  );

alter table public.user_reports
  add constraint user_reports_reviewing_claimed_check
  check (
    state <> 'reviewing'
    or (assigned_admin_user_id is not null and claimed_at is not null)
  );

create index user_reports_open_queue_idx
  on public.user_reports(created_at,id)
  where state='open' and assigned_admin_user_id is null;

create index user_reports_admin_work_idx
  on public.user_reports(assigned_admin_user_id,state,updated_at desc,id)
  where assigned_admin_user_id is not null;

drop function if exists public.get_moderation_report_queue(text,integer);

create or replace function public.get_moderation_report_queue(
  p_state text default null,
  p_assignment text default 'all',
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  report_id uuid,
  reporter_user_id uuid,
  reporter_display_name text,
  reported_user_id uuid,
  reported_display_name text,
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
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_state is not null and p_state not in ('open','reviewing','resolved','dismissed') then
    raise exception 'invalid_report_state' using errcode='22023';
  end if;
  if p_assignment not in ('all','mine','unassigned') then
    raise exception 'invalid_assignment_scope' using errcode='22023';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'invalid_queue_cursor' using errcode='22023';
  end if;

  return query
  select ur.id,ur.reporter_user_id,
    coalesce(rp.display_name,'SIGNAL member'),
    ur.reported_user_id,
    coalesce(tp.display_name,'SIGNAL member'),
    ur.reason,ur.details,ur.state,
    ur.assigned_admin_user_id,ur.claimed_at,
    ur.created_at,ur.updated_at
  from public.user_reports ur
  join public.user_profiles rp on rp.user_id=ur.reporter_user_id
  join public.user_profiles tp on tp.user_id=ur.reported_user_id
  where (p_state is null or ur.state=p_state)
    and (
      p_assignment='all'
      or (p_assignment='mine' and ur.assigned_admin_user_id=v_user_id)
      or (p_assignment='unassigned' and ur.assigned_admin_user_id is null)
    )
    and (
      p_after_created_at is null
      or (ur.created_at,ur.id)>(p_after_created_at,p_after_id)
    )
  order by ur.created_at,ur.id
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$function$;

alter function public.get_moderation_report_queue(text,text,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_moderation_report_queue(text,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_moderation_report_queue(text,text,timestamptz,uuid,integer) to authenticated;

create or replace function public.claim_next_moderation_report()
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_report_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  with next_report as (
    select ur.id
    from public.user_reports ur
    where ur.state='open' and ur.assigned_admin_user_id is null
    order by ur.created_at,ur.id
    for update skip locked
    limit 1
  )
  update public.user_reports ur
  set state='reviewing',assigned_admin_user_id=v_user_id,
      claimed_at=v_now,updated_at=v_now
  from next_report nr
  where ur.id=nr.id
  returning ur.id into v_report_id;

  return v_report_id;
end;
$function$;

alter function public.claim_next_moderation_report() owner to postgres;
revoke all on function public.claim_next_moderation_report() from public,anon;
grant execute on function public.claim_next_moderation_report() to authenticated;

create or replace function public.release_my_moderation_report(
  p_report_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  update public.user_reports
  set state='open',assigned_admin_user_id=null,claimed_at=null,updated_at=v_now
  where id=p_report_id
    and state='reviewing'
    and assigned_admin_user_id=v_user_id;

  return found;
end;
$function$;

alter function public.release_my_moderation_report(uuid) owner to postgres;
revoke all on function public.release_my_moderation_report(uuid) from public,anon;
grant execute on function public.release_my_moderation_report(uuid) to authenticated;

create or replace function public.review_user_report(
  p_report_id uuid,
  p_state text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_report public.user_reports%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_report_id is null then
    raise exception 'report_id_required' using errcode='22023';
  end if;
  if p_state not in ('resolved','dismissed') then
    raise exception 'invalid_report_review_state' using errcode='22023';
  end if;
  if p_note is not null and char_length(p_note)>2000 then
    raise exception 'moderation_note_too_long' using errcode='22023';
  end if;

  select * into v_report
  from public.user_reports
  where id=p_report_id
  for update;

  if not found then
    raise exception 'report_not_found' using errcode='P0001';
  end if;
  if v_report.state<>'reviewing'
     or v_report.assigned_admin_user_id is distinct from v_user_id then
    raise exception 'moderation_report_claim_required' using errcode='42501';
  end if;

  update public.user_reports
  set state=p_state,updated_at=v_now
  where id=p_report_id;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,
    reason,metadata,occurred_at
  )
  values(
    v_user_id,'moderation.review','user_report_state_changed',
    'user_reports',p_report_id,nullif(btrim(p_note),''),
    jsonb_build_object(
      'fromState',v_report.state,
      'toState',p_state,
      'reportedUserId',v_report.reported_user_id,
      'reporterUserId',v_report.reporter_user_id,
      'claimedAt',v_report.claimed_at
    ),v_now
  );

  return jsonb_build_object(
    'reportId',p_report_id,
    'previousState',v_report.state,
    'state',p_state,
    'updatedAt',v_now
  );
end;
$function$;

alter function public.review_user_report(uuid,text,text) owner to postgres;
revoke all on function public.review_user_report(uuid,text,text) from public,anon;
grant execute on function public.review_user_report(uuid,text,text) to authenticated;

comment on function public.claim_next_moderation_report()
is 'Atomically claims the oldest unassigned open safety report using SKIP LOCKED so concurrent moderators do not duplicate work.';
comment on function public.get_moderation_report_queue(text,text,timestamptz,uuid,integer)
is 'Cursor-paginated moderation queue with bounded page size and assignment scoping for high-volume operations.';

comment on function public.release_my_moderation_report(uuid)
is 'Returns only the caller claimed reviewing report to the shared open moderation queue.';

comment on function public.review_user_report(uuid,text,text)
is 'Finalizes only a report currently claimed by the caller and records the administrative audit action.';

commit;
