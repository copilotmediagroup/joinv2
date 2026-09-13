begin;

create or replace function public.has_admin_capability(
  p_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.admin_grants ag
    where ag.user_id=p_user_id
      and ag.capability=p_capability
      and ag.revoked_at is null
  );
$$;

alter function public.has_admin_capability(uuid,text) owner to postgres;
revoke all on function public.has_admin_capability(uuid,text) from public,anon,authenticated;

create or replace function public.get_moderation_report_queue(
  p_state text default null,
  p_limit integer default 50
)
returns table (
  report_id uuid,
  reporter_user_id uuid,
  reporter_display_name text,  reported_user_id uuid,
  reported_display_name text,
  reason text,
  details text,
  state text,
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

  return query
  select ur.id,ur.reporter_user_id,
    coalesce(rp.display_name,'SIGNAL member'),
    ur.reported_user_id,    coalesce(tp.display_name,'SIGNAL member'),
    ur.reason,ur.details,ur.state,ur.created_at,ur.updated_at
  from public.user_reports ur
  join public.user_profiles rp on rp.user_id=ur.reporter_user_id
  join public.user_profiles tp on tp.user_id=ur.reported_user_id
  where p_state is null or ur.state=p_state
  order by
    case ur.state when 'open' then 0 when 'reviewing' then 1 else 2 end,
    ur.created_at asc,ur.id
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$function$;

alter function public.get_moderation_report_queue(text,integer) owner to postgres;
revoke all on function public.get_moderation_report_queue(text,integer) from public,anon;
grant execute on function public.get_moderation_report_queue(text,integer) to authenticated;

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
begin  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_report_id is null then
    raise exception 'report_id_required' using errcode='22023';
  end if;
  if p_state not in ('reviewing','resolved','dismissed') then
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

  update public.user_reports
  set state=p_state,updated_at=v_now
  where id=p_report_id;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,
    reason,metadata,occurred_at
  )  values(
    v_user_id,'moderation.review','user_report_state_changed',
    'user_reports',p_report_id,nullif(btrim(p_note),''),
    jsonb_build_object(
      'fromState',v_report.state,
      'toState',p_state,
      'reportedUserId',v_report.reported_user_id,
      'reporterUserId',v_report.reporter_user_id
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

comment on function public.get_moderation_report_queue(text,integer)
is 'Returns safety reports only to callers holding an active moderation.review admin grant.';
comment on function public.review_user_report(uuid,text,text)
is 'Transitions a safety report review state and writes an immutable administrative audit action.';

commit;