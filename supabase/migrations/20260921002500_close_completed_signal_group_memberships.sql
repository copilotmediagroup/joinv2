begin;
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

update public.signal_group_memberships
set is_active_core=false,
ended_at=coalesce(ended_at,v_now),
updated_at=v_now
where signal_group_id=v_plan.originating_signal_group_id
and is_active_core=true;
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

-- Repair historical terminal groups that predate lifecycle membership closure.
update public.signal_group_memberships sgm
set is_active_core=false,
    ended_at=coalesce(sgm.ended_at,sg.completed_at,sg.updated_at,clock_timestamp()),
    updated_at=clock_timestamp()
from public.signal_groups sg
where sg.id=sgm.signal_group_id
  and sg.state in ('completed','cancelled','expired')
  and sgm.is_active_core=true;

commit;
