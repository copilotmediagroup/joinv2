begin;

create or replace function public.reconcile_plan_arrival_notifications(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_inserted integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>5000 then
    raise exception 'invalid_reconcile_limit' using errcode='22023';
  end if;

  with eligible as (
    select p.id as plan_id,pm.user_id
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.state in ('locked','recovery_required','active_outing')
      and pm.membership_state='active'
      and p.scheduled_starts_at is not null
      and p.scheduled_starts_at-interval '30 minutes'<=v_now
      and coalesce(p.scheduled_ends_at,p.scheduled_starts_at+interval '90 minutes')
          +interval '30 minutes'>v_now
    order by p.scheduled_starts_at,p.id,pm.id
    limit p_limit
  )  insert into public.notifications(
    user_id,type,title,body,related_plan_id,dedupe_key,created_at
  )
  select
    e.user_id,
    'plan_check_in_open',
    'CHECK-IN IS OPEN',
    'When you arrive, open your Plan and tap I’M HERE.',
    e.plan_id,
    'plan-check-in-open:'||e.plan_id::text||':'||e.user_id::text,
    v_now
  from eligible e
  on conflict(user_id,dedupe_key) do nothing;

  get diagnostics v_inserted=row_count;
  return v_inserted;
end;
$function$;

alter function public.reconcile_plan_arrival_notifications(integer) owner to postgres;
revoke all on function public.reconcile_plan_arrival_notifications(integer)
from public,anon,authenticated;
grant execute on function public.reconcile_plan_arrival_notifications(integer)
to service_role;

comment on function public.reconcile_plan_arrival_notifications(integer)
is 'Creates one check-in-open notification per active Plan member when the server-owned attendance window is open.';
create or replace function public.finalize_completed_plan_boundary()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_now timestamptz:=clock_timestamp();
begin
  if old.state is not distinct from new.state
     or new.state<>'completed'::public.plan_state then
    return new;
  end if;

  update public.plan_memberships
  set membership_state='completed'::public.plan_membership_state,
      updated_at=v_now
  where plan_id=new.id
    and membership_state='active'::public.plan_membership_state;

  update public.conversation_membership_intervals cmi
  set ended_at=coalesce(cmi.ended_at,v_now)
  from public.conversations c
  where c.plan_id=new.id
    and cmi.conversation_id=c.id
    and cmi.ended_at is null;
  insert into public.notifications(
    user_id,type,title,body,related_plan_id,dedupe_key,created_at
  )
  select
    pm.user_id,
    'plan_completed',
    'SIGNAL COMPLETE',
    'Your meetup is complete. Add a photo or video to SIGNAL Moments.',
    new.id,
    'plan-completed:'||new.id::text||':'||pm.user_id::text,
    v_now
  from public.plan_memberships pm
  where pm.plan_id=new.id
    and pm.membership_state='completed'::public.plan_membership_state
  on conflict(user_id,dedupe_key) do nothing;

  return new;
end;
$function$;

alter function public.finalize_completed_plan_boundary() owner to postgres;
revoke all on function public.finalize_completed_plan_boundary()
from public,anon,authenticated;

drop trigger if exists plan_completed_boundary on public.plans;
create trigger plan_completed_boundary
after update of state on public.plans
for each row
execute function public.finalize_completed_plan_boundary();
select cron.unschedule(jobid)
from cron.job
where jobname='plan-arrival-notifications';

select cron.schedule(
  'plan-arrival-notifications',
  '* * * * *',
  'select public.reconcile_plan_arrival_notifications(500);'
);

commit;
