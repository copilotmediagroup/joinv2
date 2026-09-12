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
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_plan public.plans%rowtype;
  v_activated integer:=0;
  v_completed integer:=0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid_reconcile_limit' using errcode='22023';
  end if;

  -- Repair legacy signal Plans that predate durable end times.
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
       and v_plan.scheduled_ends_at <= v_now then
      update public.plans
      set state='completed'::public.plan_state,
          updated_at=v_now
      where id=v_plan.id
        and state in ('locked','recovery_required','active_outing');

      if found then
        v_completed:=v_completed+1;
        insert into public.plan_history(
          plan_id,event_type,actor_user_id,reason,metadata,occurred_at
        )
        select v_plan.id,'completed'::public.plan_history_event_type,null,
          'Plan completed by lifecycle authority',
          jsonb_build_object('source','plan_lifecycle_authority'),v_now
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
          updated_at=v_now
      where id=v_plan.id
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
$function$;

alter function public.reconcile_plan_lifecycle(integer) owner to postgres;
revoke all on function public.reconcile_plan_lifecycle(integer) from public,anon,authenticated;
grant execute on function public.reconcile_plan_lifecycle(integer) to service_role;

select * from public.reconcile_plan_lifecycle(5000);

select cron.unschedule(jobid)
from cron.job
where jobname='plan-lifecycle-reconcile';

select cron.schedule(
  'plan-lifecycle-reconcile',
  '* * * * *',
  'select public.reconcile_plan_lifecycle(500);'
);

commit;
