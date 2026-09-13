begin;

create table public.account_access_state (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  restriction text not null check (restriction in ('suspended','banned')),
  restricted_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint account_access_state_suspension_until check (
    restriction<>'suspended' or restricted_until is not null
  )
);

create table public.account_enforcements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  action text not null check (action in ('warning','suspension','ban','lift')),
  reason text not null,
  source_report_id uuid references public.user_reports(id) on delete set null,
  imposed_by_user_id uuid not null references public.user_profiles(user_id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index account_enforcements_user_time_idx
on public.account_enforcements(user_id,created_at desc);
create index account_enforcements_source_report_idx
on public.account_enforcements(source_report_id)
where source_report_id is not null;

alter table public.account_access_state enable row level security;
alter table public.account_enforcements enable row level security;
revoke all on public.account_access_state,public.account_enforcements
from public,anon,authenticated;
grant select on public.account_access_state to authenticated;
grant all on public.account_access_state,public.account_enforcements to service_role;

create policy account_access_state_select_own
on public.account_access_state
for select
to authenticated
using ((select auth.uid())=user_id);

create or replace function public.check_account_access()
returns void
language plpgsql
security invoker
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_state public.account_access_state%rowtype;
begin
  if v_user_id is null then
    return;
  end if;

  select * into v_state
  from public.account_access_state
  where user_id=v_user_id;

  if not found then
    return;
  end if;

  if v_state.restriction='suspended'
     and v_state.restricted_until<=clock_timestamp() then
    return;
  end if;

  raise sqlstate 'PGRST' using
    message=json_build_object(
      'code','account_restricted',
      'message','This account is temporarily unavailable.'
    )::text,
    detail=json_build_object('status',403)::text;
end;
$function$;

alter function public.check_account_access() owner to postgres;
revoke all on function public.check_account_access() from public;
grant execute on function public.check_account_access() to anon,authenticated;
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
  );
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
    'restrictedUntil',case when p_action='ban' then null else v_until end
  );
end;
$function$;

alter function public.enforce_user_account(uuid,text,integer,text,uuid) owner to postgres;
revoke all on function public.enforce_user_account(uuid,text,integer,text,uuid) from public,anon;
grant execute on function public.enforce_user_account(uuid,text,integer,text,uuid) to authenticated;

create or replace function public.lift_user_account_restriction(
  p_target_user_id uuid,
  p_reason text
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
  if p_reason is null or length(btrim(p_reason))<3 or char_length(p_reason)>2000 then
    raise exception 'invalid_enforcement_reason' using errcode='22023';
  end if;

  delete from public.account_access_state
  where user_id=p_target_user_id
  returning * into v_deleted;
  if not found then
    return false;
  end if;

  update auth.users
  set banned_until=null,updated_at=v_now
  where id=p_target_user_id;

  insert into public.account_enforcements(
    user_id,action,reason,imposed_by_user_id,
    starts_at,metadata,created_at
  ) values(
    p_target_user_id,'lift',btrim(p_reason),v_admin_user_id,
    v_now,jsonb_build_object(
      'previousRestriction',v_deleted.restriction,
      'previousRestrictedUntil',v_deleted.restricted_until
    ),v_now
  );

  insert into public.administrative_actions(
    admin_user_id,capability,action_type,target_table,target_id,
    reason,metadata,occurred_at
  ) values(
    v_admin_user_id,'moderation.enforce','account_restriction_lifted',
    'user_profiles',p_target_user_id,btrim(p_reason),
    jsonb_build_object(
      'previousRestriction',v_deleted.restriction,
      'previousRestrictedUntil',v_deleted.restricted_until
    ),v_now
  );

  return true;
end;
$function$;

alter function public.lift_user_account_restriction(uuid,text) owner to postgres;
revoke all on function public.lift_user_account_restriction(uuid,text) from public,anon;
grant execute on function public.lift_user_account_restriction(uuid,text) to authenticated;
alter role authenticator
set pgrst.db_pre_request='public.check_account_access';
notify pgrst,'reload config';

comment on table public.account_access_state
is 'Hot-path account restriction state used by the Data API pre-request guard.';
comment on table public.account_enforcements
is 'Immutable moderation enforcement history for warnings, suspensions, bans, and lifts.';
comment on function public.enforce_user_account(uuid,text,integer,text,uuid)
is 'Capability-gated moderator enforcement. Suspensions and bans update Auth, revoke refresh sessions, and activate the Data API restriction guard.';
comment on function public.lift_user_account_restriction(uuid,text)
is 'Capability-gated lift of a current suspension or ban with immutable administrative audit history.';

commit;
