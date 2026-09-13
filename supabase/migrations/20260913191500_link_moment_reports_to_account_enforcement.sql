begin;

alter table public.account_enforcements
  add column source_moment_report_id uuid references public.signal_moment_reports(id) on delete set null;

alter table public.account_enforcements
  add constraint account_enforcements_one_source_check
  check (num_nonnulls(source_report_id,source_moment_report_id)<=1);

create index account_enforcements_source_moment_report_idx
on public.account_enforcements(source_moment_report_id)
where source_moment_report_id is not null;

create or replace function public.enforce_user_account(
  p_target_user_id uuid,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default null,
  p_source_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_until timestamptz;
  v_existing public.account_access_state%rowtype;
  v_enforcement_id uuid;
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.enforce') then
    raise exception 'moderation_enforcement_capability_required' using errcode='42501';
  end if;
  if p_target_user_id is null or p_target_user_id=v_admin_user_id then
    raise exception 'invalid_enforcement_target' using errcode='22023';
  end if;
  if p_action not in ('warning','suspension','ban') then
    raise exception 'invalid_enforcement_action' using errcode='22023';
  end if;
  if p_reason is null or length(btrim(p_reason))<3 or char_length(p_reason)>2000 then
    raise exception 'invalid_enforcement_reason' using errcode='22023';
  end if;
  if not exists(select 1 from public.user_profiles where user_id=p_target_user_id) then
    raise exception 'user_not_found' using errcode='P0001';
  end if;
  if p_source_report_id is not null and not exists(
    select 1 from public.user_reports
    where id=p_source_report_id and reported_user_id=p_target_user_id
  ) then
    raise exception 'invalid_source_report' using errcode='22023';
  end if;

  select * into v_existing
  from public.account_access_state
  where user_id=p_target_user_id
  for update;

  if p_action='suspension' then
    if p_duration_minutes is null or p_duration_minutes<15 or p_duration_minutes>43200 then
      raise exception 'invalid_suspension_duration' using errcode='22023';
    end if;
    if found and v_existing.restriction='banned' then
      raise exception 'account_already_banned' using errcode='P0001';
    end if;
    v_until:=v_now+make_interval(mins=>p_duration_minutes);
  elsif p_action='ban' then
    v_until:=v_now+interval '100 years';
  end if;
  if p_action in ('suspension','ban') then
    insert into public.account_access_state(user_id,restriction,restricted_until,updated_at)
    values(
      p_target_user_id,
      case when p_action='ban' then 'banned' else 'suspended' end,
      case when p_action='ban' then null else v_until end,
      v_now
    )
    on conflict(user_id) do update
      set restriction=excluded.restriction,
          restricted_until=excluded.restricted_until,
          updated_at=excluded.updated_at;

    update auth.users
    set banned_until=v_until,
        updated_at=v_now
    where id=p_target_user_id;

    delete from auth.sessions where user_id=p_target_user_id;
  end if;

  insert into public.account_enforcements(
    user_id,action,reason,source_report_id,imposed_by_user_id,
    starts_at,ends_at,metadata,created_at
  ) values(
    p_target_user_id,p_action,btrim(p_reason),p_source_report_id,v_admin_user_id,
    v_now,case when p_action='suspension' then v_until else null end,
    jsonb_build_object('durationMinutes',p_duration_minutes),v_now
  ) returning id into v_enforcement_id;
  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,
    reason,metadata,occurred_at
  ) values(
    v_admin_user_id,'moderation.enforce','account_'||p_action,
    'user_profiles',p_target_user_id,btrim(p_reason),
    jsonb_build_object(
      'sourceReportId',p_source_report_id,
      'durationMinutes',p_duration_minutes,
      'restrictedUntil',v_until
    ),v_now
  );

  return jsonb_build_object(
    'userId',p_target_user_id,
    'action',p_action,
    'restrictedUntil',case when p_action='ban' then null else v_until end,
    'enforcementId',v_enforcement_id
  );
end;
$function$;
alter function public.enforce_user_account(uuid,text,integer,text,uuid) owner to postgres;
revoke all on function public.enforce_user_account(uuid,text,integer,text,uuid) from public,anon;
grant execute on function public.enforce_user_account(uuid,text,integer,text,uuid) to authenticated;

create or replace function public.enforce_moment_author_account(
  p_report_id uuid,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_author_user_id uuid;
  v_result jsonb;
  v_enforcement_id uuid;
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.enforce') then
    raise exception 'moderation_enforcement_capability_required' using errcode='42501';
  end if;
  select sm.author_user_id
  into v_author_user_id
  from public.signal_moment_reports smr
  join public.signal_moments sm on sm.id=smr.moment_id
  where smr.id=p_report_id;

  if v_author_user_id is null then
    raise exception 'moment_report_not_found' using errcode='P0001';
  end if;

  v_result:=public.enforce_user_account(
    v_author_user_id,p_action,p_duration_minutes,p_reason,null
  );
  v_enforcement_id:=(v_result->>'enforcementId')::uuid;

  update public.account_enforcements
  set source_moment_report_id=p_report_id
  where id=v_enforcement_id
    and user_id=v_author_user_id
    and imposed_by_user_id=v_admin_user_id;

  if not found then
    raise exception 'moment_enforcement_link_failed' using errcode='P0001';
  end if;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,reason,metadata,occurred_at
  ) values(
    v_admin_user_id,'moderation.enforce','moment_account_enforcement_link',
    'signal_moment_reports',p_report_id,btrim(p_reason),
    jsonb_build_object('enforcementId',v_enforcement_id,'authorUserId',v_author_user_id,'action',p_action),
    clock_timestamp()
  );

  return v_result || jsonb_build_object('sourceMomentReportId',p_report_id);
end;
$function$;
alter function public.enforce_moment_author_account(uuid,text,integer,text) owner to postgres;
revoke all on function public.enforce_moment_author_account(uuid,text,integer,text) from public,anon;
grant execute on function public.enforce_moment_author_account(uuid,text,integer,text) to authenticated;

comment on function public.enforce_moment_author_account(uuid,text,integer,text)
is 'Capability-gated account enforcement linked atomically to a Signal Moment report.';

commit;
