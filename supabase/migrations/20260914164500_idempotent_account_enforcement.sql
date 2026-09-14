begin;

alter table public.account_enforcements
  add column if not exists client_action_id uuid;

create unique index if not exists account_enforcements_admin_client_action_uidx
on public.account_enforcements(imposed_by_user_id,client_action_id)
where client_action_id is not null;

create or replace function public.enforce_user_account_v2(
  p_target_user_id uuid,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default null,
  p_source_report_id uuid default null,
  p_source_moment_report_id uuid default null,
  p_client_action_id uuid default null
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
  v_prior public.account_enforcements%rowtype;
  v_enforcement_id uuid;
  v_requested_duration text;
  v_source_valid boolean;
  v_existing_found boolean;
begin
  if v_admin_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.enforce') then
    raise exception 'moderation_enforcement_capability_required' using errcode='42501';
  end if;
  if p_client_action_id is null then raise exception 'client_action_id_required' using errcode='22023'; end if;
  if p_target_user_id is null or p_target_user_id=v_admin_user_id then raise exception 'invalid_enforcement_target' using errcode='22023'; end if;
  if p_action not in ('warning','suspension','ban') then raise exception 'invalid_enforcement_action' using errcode='22023'; end if;
  if p_reason is null or length(btrim(p_reason))<3 or char_length(p_reason)>2000 then raise exception 'invalid_enforcement_reason' using errcode='22023'; end if;
  if num_nonnulls(p_source_report_id,p_source_moment_report_id)>1 then raise exception 'invalid_enforcement_source' using errcode='22023'; end if;

  v_requested_duration:=case when p_duration_minutes is null then null else p_duration_minutes::text end;

  perform 1 from public.user_profiles where user_id=p_target_user_id for update;
  if not found then raise exception 'user_not_found' using errcode='P0001'; end if;

  select * into v_prior
  from public.account_enforcements
  where imposed_by_user_id=v_admin_user_id and client_action_id=p_client_action_id;
  if found then
    if v_prior.user_id is distinct from p_target_user_id
       or v_prior.action is distinct from p_action
       or v_prior.reason is distinct from btrim(p_reason)
       or v_prior.source_report_id is distinct from p_source_report_id
       or v_prior.source_moment_report_id is distinct from p_source_moment_report_id
       or (v_prior.metadata->>'durationMinutes') is distinct from v_requested_duration then
      raise exception 'enforcement_idempotency_conflict' using errcode='22023';
    end if;
    return jsonb_build_object(
      'userId',v_prior.user_id,'action',v_prior.action,
      'restrictedUntil',case when v_prior.action='suspension' then v_prior.ends_at else null end,
      'enforcementId',v_prior.id
    );
  end if;

  if p_source_report_id is not null then
    select exists(
      select 1 from public.user_reports
      where id=p_source_report_id and reported_user_id=p_target_user_id
    ) into v_source_valid;
    if not v_source_valid then raise exception 'invalid_source_report' using errcode='22023'; end if;
  end if;
  if p_source_moment_report_id is not null then
    select exists(
      select 1 from public.signal_moment_reports smr
      join public.signal_moments sm on sm.id=smr.moment_id
      where smr.id=p_source_moment_report_id and sm.author_user_id=p_target_user_id
    ) into v_source_valid;
    if not v_source_valid then raise exception 'invalid_source_moment_report' using errcode='22023'; end if;
  end if;

  select * into v_existing from public.account_access_state
  where user_id=p_target_user_id for update;
  v_existing_found:=found;

  if p_action='suspension' then
    if p_duration_minutes is null or p_duration_minutes<15 or p_duration_minutes>43200 then
      raise exception 'invalid_suspension_duration' using errcode='22023';
    end if;
    if v_existing_found and v_existing.restriction='banned' then raise exception 'account_already_banned' using errcode='P0001'; end if;
    v_until:=v_now+make_interval(mins=>p_duration_minutes);
  elsif p_action='ban' then
    v_until:=v_now+interval '100 years';
  end if;

  insert into public.account_enforcements(
    user_id,action,reason,source_report_id,source_moment_report_id,imposed_by_user_id,
    starts_at,ends_at,metadata,client_action_id,created_at
  ) values(
    p_target_user_id,p_action,btrim(p_reason),p_source_report_id,p_source_moment_report_id,v_admin_user_id,
    v_now,case when p_action='suspension' then v_until else null end,
    jsonb_build_object('durationMinutes',p_duration_minutes),p_client_action_id,v_now
  ) returning id into v_enforcement_id;

  if p_action in ('suspension','ban') then
    insert into public.account_access_state(user_id,restriction,restricted_until,updated_at)
    values(
      p_target_user_id,
      case when p_action='ban' then 'banned' else 'suspended' end,
      case when p_action='ban' then null else v_until end,
      v_now
    )
    on conflict(user_id) do update set
      restriction=excluded.restriction,
      restricted_until=excluded.restricted_until,
      updated_at=excluded.updated_at;

    update auth.users set banned_until=v_until,updated_at=v_now where id=p_target_user_id;
    delete from auth.sessions where user_id=p_target_user_id;
  end if;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,reason,metadata,occurred_at
  ) values(
    v_admin_user_id,'moderation.enforce','account_'||p_action,'user_profiles',p_target_user_id,btrim(p_reason),
    jsonb_build_object(
      'sourceReportId',p_source_report_id,'sourceMomentReportId',p_source_moment_report_id,
      'durationMinutes',p_duration_minutes,'restrictedUntil',v_until,
      'clientActionId',p_client_action_id,'enforcementId',v_enforcement_id
    ),v_now
  );

  return jsonb_build_object(
    'userId',p_target_user_id,'action',p_action,
    'restrictedUntil',case when p_action='ban' then null else v_until end,
    'enforcementId',v_enforcement_id
  );
end;
$function$;

create or replace function public.lift_user_account_restriction_v2(
  p_target_user_id uuid,
  p_reason text,
  p_client_action_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_deleted public.account_access_state%rowtype;
  v_prior public.account_enforcements%rowtype;
  v_enforcement_id uuid;
begin
  if v_admin_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.enforce') then raise exception 'moderation_enforcement_capability_required' using errcode='42501'; end if;
  if p_client_action_id is null then raise exception 'client_action_id_required' using errcode='22023'; end if;
  if p_target_user_id is null or p_target_user_id=v_admin_user_id then raise exception 'invalid_enforcement_target' using errcode='22023'; end if;
  if p_reason is null or length(btrim(p_reason))<3 or char_length(p_reason)>2000 then raise exception 'invalid_enforcement_reason' using errcode='22023'; end if;

  perform 1 from public.user_profiles where user_id=p_target_user_id for update;
  if not found then raise exception 'user_not_found' using errcode='P0001'; end if;

  select * into v_prior from public.account_enforcements
  where imposed_by_user_id=v_admin_user_id and client_action_id=p_client_action_id;
  if found then
    if v_prior.user_id is distinct from p_target_user_id
       or v_prior.action is distinct from 'lift'
       or v_prior.reason is distinct from btrim(p_reason) then
      raise exception 'enforcement_idempotency_conflict' using errcode='22023';
    end if;
    return true;
  end if;

  delete from public.account_access_state
  where user_id=p_target_user_id returning * into v_deleted;
  if not found then return false; end if;

  update auth.users set banned_until=null,updated_at=v_now where id=p_target_user_id;

  insert into public.account_enforcements(
    user_id,action,reason,imposed_by_user_id,starts_at,metadata,client_action_id,created_at
  ) values(
    p_target_user_id,'lift',btrim(p_reason),v_admin_user_id,v_now,
    jsonb_build_object(
      'previousRestriction',v_deleted.restriction,
      'previousRestrictedUntil',v_deleted.restricted_until
    ),p_client_action_id,v_now
  ) returning id into v_enforcement_id;

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,reason,metadata,occurred_at
  ) values(
    v_admin_user_id,'moderation.enforce','account_restriction_lifted','user_profiles',p_target_user_id,btrim(p_reason),
    jsonb_build_object(
      'previousRestriction',v_deleted.restriction,
      'previousRestrictedUntil',v_deleted.restricted_until,
      'clientActionId',p_client_action_id,'enforcementId',v_enforcement_id
    ),v_now
  );
  return true;
end;
$function$;

create or replace function public.enforce_moment_author_account_v2(
  p_report_id uuid,
  p_action text,
  p_duration_minutes integer default null,
  p_reason text default null,
  p_client_action_id uuid default null
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
begin
  if v_admin_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.enforce') then raise exception 'moderation_enforcement_capability_required' using errcode='42501'; end if;

  select sm.author_user_id into v_author_user_id
  from public.signal_moment_reports smr
  join public.signal_moments sm on sm.id=smr.moment_id
  where smr.id=p_report_id;
  if v_author_user_id is null then raise exception 'moment_report_not_found' using errcode='P0001'; end if;

  v_result:=public.enforce_user_account_v2(
    v_author_user_id,p_action,p_duration_minutes,p_reason,null,p_report_id,p_client_action_id
  );
  return v_result || jsonb_build_object('sourceMomentReportId',p_report_id);
end;
$function$;

alter function public.enforce_user_account_v2(uuid,text,integer,text,uuid,uuid,uuid) owner to postgres;
alter function public.lift_user_account_restriction_v2(uuid,text,uuid) owner to postgres;
alter function public.enforce_moment_author_account_v2(uuid,text,integer,text,uuid) owner to postgres;

revoke all on function public.enforce_user_account_v2(uuid,text,integer,text,uuid,uuid,uuid) from public,anon;
revoke all on function public.lift_user_account_restriction_v2(uuid,text,uuid) from public,anon;
revoke all on function public.enforce_moment_author_account_v2(uuid,text,integer,text,uuid) from public,anon;
grant execute on function public.enforce_user_account_v2(uuid,text,integer,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.lift_user_account_restriction_v2(uuid,text,uuid) to authenticated;
grant execute on function public.enforce_moment_author_account_v2(uuid,text,integer,text,uuid) to authenticated;

comment on column public.account_enforcements.client_action_id
is 'Per-admin idempotency token for one account enforcement click.';
comment on function public.enforce_user_account_v2(uuid,text,integer,text,uuid,uuid,uuid)
is 'Retry-safe capability-gated account enforcement using a per-click client action UUID.';
comment on function public.lift_user_account_restriction_v2(uuid,text,uuid)
is 'Retry-safe restriction lift using a per-click client action UUID.';
comment on function public.enforce_moment_author_account_v2(uuid,text,integer,text,uuid)
is 'Retry-safe Moment-author account enforcement linked directly to the source Moment report.';

commit;
