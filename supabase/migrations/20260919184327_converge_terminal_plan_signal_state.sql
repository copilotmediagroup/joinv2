begin;

create or replace function public.sync_terminal_plan_signal_state()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $function$
declare
  v_terminal_at timestamptz;
begin
  if new.originating_signal_group_id is null
     or new.state not in ('cancelled'::public.plan_state,'completed'::public.plan_state)
     or (tg_op='UPDATE' and old.state=new.state) then
    return new;
  end if;

  v_terminal_at:=case
    when new.state='cancelled'::public.plan_state
      then coalesce(new.cancelled_at,new.updated_at,clock_timestamp())
    else coalesce(new.completed_at,new.updated_at,clock_timestamp())
  end;

  if new.state='cancelled'::public.plan_state then
    update public.signal_groups
    set state='cancelled'::public.signal_group_state,
        cancelled_at=coalesce(cancelled_at,v_terminal_at),
        journey_stage='completed',
        updated_at=clock_timestamp()
    where id=new.originating_signal_group_id
      and state not in ('cancelled','completed','expired');
  else
    update public.signal_groups
    set state='completed'::public.signal_group_state,
        completed_at=coalesce(completed_at,v_terminal_at),
        journey_stage='completed',
        updated_at=clock_timestamp()
    where id=new.originating_signal_group_id
      and state not in ('cancelled','completed','expired');
  end if;

  return new;
end;
$function$;

drop trigger if exists plans_sync_terminal_signal_state on public.plans;
create trigger plans_sync_terminal_signal_state
after insert or update of state on public.plans
for each row execute function public.sync_terminal_plan_signal_state();

update public.signal_groups sg
set state='cancelled'::public.signal_group_state,
    cancelled_at=coalesce(sg.cancelled_at,p.cancelled_at,p.updated_at,clock_timestamp()),
    journey_stage='completed',
    updated_at=clock_timestamp()
from public.plans p
where p.originating_signal_group_id=sg.id
  and p.state='cancelled'::public.plan_state
  and sg.state not in ('cancelled','completed','expired');

update public.signal_groups sg
set state='completed'::public.signal_group_state,
    completed_at=coalesce(sg.completed_at,p.completed_at,p.updated_at,clock_timestamp()),
    journey_stage='completed',
    updated_at=clock_timestamp()
from public.plans p
where p.originating_signal_group_id=sg.id
  and p.state='completed'::public.plan_state
  and sg.state not in ('cancelled','completed','expired');

comment on function public.sync_terminal_plan_signal_state()
is 'Converges terminal Signal Plan state into its originating Signal group; Plan is the terminal lifecycle authority.';

commit;
