begin;

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
  if v_report.state=p_state
     and v_report.assigned_admin_user_id=v_user_id
     and exists (
       select 1
       from public.administrative_actions aa
       where aa.admin_user_id=v_user_id
         and aa.action_type='user_report_state_changed'
         and aa.target_table='user_reports'
         and aa.target_id=p_report_id
         and aa.metadata->>'toState'=p_state
         and aa.reason is not distinct from nullif(btrim(p_note),'')
     ) then
    return jsonb_build_object(
      'reportId',p_report_id,'previousState',p_state,'state',p_state,
      'updatedAt',v_report.updated_at,'recovered',true
    );
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
  if v_report.state=p_state
     and v_report.assigned_admin_user_id=v_admin_user_id
     and exists (
       select 1
       from public.administrative_actions aa
       where aa.admin_user_id=v_admin_user_id
         and aa.action_type='signal_moment_report_'||p_state
         and aa.target_table='signal_moment_reports'
         and aa.target_id=p_report_id
         and aa.reason is not distinct from nullif(btrim(p_note),'')
     ) then
    return true;
  end if;

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

comment on function public.review_user_report(uuid,text,text) is 'Finalizes a moderator-owned safety report and safely recovers an identical retry without duplicating audit history.';
comment on function public.review_moderation_moment(uuid,text,text) is 'Finalizes a moderator-owned Moment report and safely recovers an identical retry without duplicating audit history.';

commit;
