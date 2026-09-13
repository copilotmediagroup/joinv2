begin;

-- One self check-in and one system verification per person/Plan.
create unique index if not exists attendance_records_one_self_report_per_plan_user
on public.attendance_records(plan_id,user_id)
where evidence_type='self_reported'::public.attendance_evidence_type;

create unique index if not exists attendance_records_one_system_verify_per_plan_user
on public.attendance_records(plan_id,user_id)
where evidence_type='system_verified'::public.attendance_evidence_type;

create or replace function public.get_my_plan_attendance_status(
  p_plan_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_plan public.plans%rowtype;
  v_membership public.plan_memberships%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_checked_in_at timestamptz;
  v_verified boolean:=false;
  v_checked_count integer:=0;
  v_active_count integer:=0;
begin  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select p.* into v_plan
  from public.plans p
  where p.id=p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode='P0001';
  end if;

  select pm.* into v_membership
  from public.plan_memberships pm
  where pm.plan_id=p_plan_id
    and pm.user_id=v_user_id
    and pm.membership_state='active'::public.plan_membership_state;
  if not found then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  if v_plan.scheduled_starts_at is not null then
    v_window_open:=v_plan.scheduled_starts_at-interval '30 minutes';
    v_window_close:=coalesce(
      v_plan.scheduled_ends_at,
      v_plan.scheduled_starts_at+interval '90 minutes'
    )+interval '30 minutes';
  end if;

  select min(ar.occurred_at)
  into v_checked_in_at
  from public.attendance_records ar
  where ar.plan_id=p_plan_id
    and ar.user_id=v_user_id;  select exists(
    select 1
    from public.attendance_records ar
    where ar.plan_id=p_plan_id
      and ar.user_id=v_user_id
      and ar.evidence_type in (
        'location_supported'::public.attendance_evidence_type,
        'partner_verified'::public.attendance_evidence_type,
        'system_verified'::public.attendance_evidence_type
      )
  ) into v_verified;

  select count(distinct ar.user_id)::integer
  into v_checked_count
  from public.attendance_records ar
  where ar.plan_id=p_plan_id;

  select count(*)::integer
  into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=p_plan_id
    and pm.membership_state='active'::public.plan_membership_state;

  return jsonb_build_object(
    'planId',p_plan_id,
    'planState',v_plan.state::text,
    'serverNow',v_now,
    'windowOpensAt',v_window_open,
    'windowClosesAt',v_window_close,
    'canCheckIn',(
      v_checked_in_at is null
      and v_window_open is not null
      and v_now between v_window_open and v_window_close
      and v_plan.state in ('locked','recovery_required','active_outing')
    ),    'checkedIn',(v_checked_in_at is not null),
    'checkedInAt',v_checked_in_at,
    'verified',v_verified,
    'checkedInCount',v_checked_count,
    'activeMemberCount',v_active_count
  );
end;
$function$;

alter function public.get_my_plan_attendance_status(uuid) owner to postgres;
revoke all on function public.get_my_plan_attendance_status(uuid) from public,anon;
grant execute on function public.get_my_plan_attendance_status(uuid) to authenticated;

create or replace function public.check_in_to_my_plan(
  p_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_plan public.plans%rowtype;
  v_membership public.plan_memberships%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_window_open timestamptz;
  v_window_close timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;  select p.* into v_plan
  from public.plans p
  where p.id=p_plan_id
  for update;
  if not found then
    raise exception 'plan_not_found' using errcode='P0001';
  end if;

  select pm.* into v_membership
  from public.plan_memberships pm
  where pm.plan_id=p_plan_id
    and pm.user_id=v_user_id
    and pm.membership_state='active'::public.plan_membership_state
  for update;
  if not found then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  if v_plan.scheduled_starts_at is null then
    raise exception 'plan_start_time_required' using errcode='P0001';
  end if;

  v_window_open:=v_plan.scheduled_starts_at-interval '30 minutes';
  v_window_close:=coalesce(
    v_plan.scheduled_ends_at,
    v_plan.scheduled_starts_at+interval '90 minutes'
  )+interval '30 minutes';

  if v_plan.state not in ('locked','recovery_required','active_outing') then
    raise exception 'plan_not_open_for_check_in' using errcode='P0001';
  end if;

  if v_now<v_window_open or v_now>v_window_close then
    raise exception 'check_in_window_closed' using errcode='P0001';
  end if;  insert into public.attendance_records(
    plan_id,plan_membership_id,user_id,venue_id,
    evidence_type,confidence,occurred_at
  )
  values(
    p_plan_id,v_membership.id,v_user_id,null,
    'self_reported'::public.attendance_evidence_type,null,v_now
  )
  on conflict (plan_id,user_id)
  where evidence_type='self_reported'::public.attendance_evidence_type
  do nothing;

  return public.get_my_plan_attendance_status(p_plan_id);
end;
$function$;

alter function public.check_in_to_my_plan(uuid) owner to postgres;
revoke all on function public.check_in_to_my_plan(uuid) from public,anon;
grant execute on function public.check_in_to_my_plan(uuid) to authenticated;

comment on function public.check_in_to_my_plan(uuid)
is 'Authenticated Plan member self check-in. Server owns eligibility window and operation is idempotent.';

-- Extend lifecycle completion: mutual check-ins become system-verified show-ups.
create or replace function public.reconcile_plan_lifecycle(
  p_limit integer default 500
)
returns table (
  activated_plan_count integer,
  completed_plan_count integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$declare
  v_now timestamptz:=clock_timestamp();
  v_plan public.plans%rowtype;
  v_activated integer:=0;
  v_completed integer:=0;
  v_self_report_count integer:=0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid_reconcile_limit' using errcode='22023';
  end if;

  update public.plans
  set scheduled_ends_at=scheduled_starts_at+interval '90 minutes',
      updated_at=v_now
  where origin='signal'
    and scheduled_starts_at is not null
    and scheduled_ends_at is null
    and state in ('locked','recovery_required','active_outing');

  for v_plan in
    select p.*
    from public.plans p
    where p.state in ('locked','recovery_required','active_outing')
      and p.scheduled_starts_at is not null
      and p.scheduled_starts_at <= v_now
    order by p.scheduled_starts_at,p.id
    limit p_limit
    for update skip locked
  loop
    if v_plan.scheduled_ends_at is not null
       and v_plan.scheduled_ends_at <= v_now then      update public.plans
      set state='completed'::public.plan_state,
          completed_at=coalesce(completed_at,v_now),
          updated_at=v_now
      where id=v_plan.id
        and state in ('locked','recovery_required','active_outing');

      if found then
        v_completed:=v_completed+1;

        select count(distinct ar.user_id)::integer
        into v_self_report_count
        from public.attendance_records ar
        where ar.plan_id=v_plan.id
          and ar.evidence_type='self_reported'::public.attendance_evidence_type;

        if v_self_report_count>=2 then
          insert into public.attendance_records(
            plan_id,plan_membership_id,user_id,venue_id,
            evidence_type,confidence,occurred_at
          )
          select
            ar.plan_id,ar.plan_membership_id,ar.user_id,ar.venue_id,
            'system_verified'::public.attendance_evidence_type,
            0.80,ar.occurred_at
          from public.attendance_records ar
          where ar.plan_id=v_plan.id
            and ar.evidence_type='self_reported'::public.attendance_evidence_type
          on conflict (plan_id,user_id)
          where evidence_type='system_verified'::public.attendance_evidence_type
          do nothing;
        end if;        insert into public.plan_history(
          plan_id,event_type,actor_user_id,reason,metadata,occurred_at
        )
        select v_plan.id,'completed'::public.plan_history_event_type,null,
          'Plan completed by lifecycle authority',
          jsonb_build_object(
            'source','plan_lifecycle_authority',
            'selfReportedCheckIns',v_self_report_count,
            'attendanceVerified',v_self_report_count>=2
          ),v_now
        where not exists (
          select 1 from public.plan_history ph
          where ph.plan_id=v_plan.id
            and ph.event_type='completed'::public.plan_history_event_type
        );

        if v_plan.originating_signal_group_id is not null then
          update public.signal_groups
          set state='completed'::public.signal_group_state,
              completed_at=coalesce(completed_at,v_now),
              updated_at=v_now
          where id=v_plan.originating_signal_group_id
            and state not in ('completed','cancelled','expired');
        end if;
      end if;

    elsif v_plan.state in ('locked','recovery_required') then
      update public.plans
      set state='active_outing'::public.plan_state,
          active_outing_at=coalesce(active_outing_at,v_now),
          updated_at=v_now      where id=v_plan.id
        and state in ('locked','recovery_required');

      if found then
        v_activated:=v_activated+1;
        insert into public.plan_history(
          plan_id,event_type,actor_user_id,reason,metadata,occurred_at
        )
        select v_plan.id,'active_outing'::public.plan_history_event_type,null,
          'Plan started by lifecycle authority',
          jsonb_build_object('source','plan_lifecycle_authority'),v_now
        where not exists (
          select 1 from public.plan_history ph
          where ph.plan_id=v_plan.id
            and ph.event_type='active_outing'::public.plan_history_event_type
        );

        if v_plan.originating_signal_group_id is not null then
          update public.signal_groups
          set state='active_outing'::public.signal_group_state,
              updated_at=v_now
          where id=v_plan.originating_signal_group_id
            and state='locked'::public.signal_group_state;
        end if;
      end if;
    end if;
  end loop;

  return query select v_activated,v_completed;
end;
$function$;alter function public.reconcile_plan_lifecycle(integer) owner to postgres;
revoke all on function public.reconcile_plan_lifecycle(integer) from public,anon,authenticated;
grant execute on function public.reconcile_plan_lifecycle(integer) to service_role;

comment on function public.get_my_plan_attendance_status(uuid)
is 'Returns caller-owned Plan attendance/check-in state and server-owned check-in window.';

comment on function public.reconcile_plan_lifecycle(integer)
is 'Activates/completes Plans and promotes mutual self check-ins to system-verified attendance on completion.';

commit;