begin;

create or replace function public.notify_plan_replacement_history()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid;
  v_replacement_user_id uuid;
begin
  if new.event_type='recovery_required'::public.plan_history_event_type then
    for v_user_id in
      select pm.user_id from public.plan_memberships pm
      where pm.plan_id=new.plan_id
        and pm.membership_state='active'::public.plan_membership_state
    loop
      insert into public.notifications(
        user_id,type,title,body,related_plan_id,dedupe_key,created_at
      ) values (
        v_user_id,'plan_replacement_open','FINDING A REPLACEMENT',
        'Someone left. SIGNAL is holding your Plan while we find a compatible replacement.',
        new.plan_id,'plan-history:'||new.id::text||':'||v_user_id::text,new.occurred_at
      ) on conflict(user_id,dedupe_key) do nothing;
    end loop;
  elsif new.event_type='member_admitted'::public.plan_history_event_type
        and new.metadata ? 'replacement_user_id' then
    v_replacement_user_id:=(new.metadata->>'replacement_user_id')::uuid;
    insert into public.notifications(
      user_id,type,title,body,related_plan_id,dedupe_key,created_at
    ) values (
      v_replacement_user_id,'plan_replacement_admitted','YOU’RE IN',
      'You filled an open SIGNAL seat. The Plan is ready for you.',
      new.plan_id,'plan-history:'||new.id::text||':'||v_replacement_user_id::text,new.occurred_at
    ) on conflict(user_id,dedupe_key) do nothing;

  elsif new.event_type='recovery_resolved'::public.plan_history_event_type then
    for v_user_id in
      select pm.user_id from public.plan_memberships pm
      where pm.plan_id=new.plan_id
        and pm.membership_state='active'::public.plan_membership_state
    loop
      insert into public.notifications(
        user_id,type,title,body,related_plan_id,dedupe_key,created_at
      ) values (
        v_user_id,'plan_replacement_filled','WE’RE BACK',
        'A compatible replacement joined. Your SIGNAL Plan is back on.',
        new.plan_id,'plan-history:'||new.id::text||':'||v_user_id::text,new.occurred_at
      ) on conflict(user_id,dedupe_key) do nothing;
    end loop;
  elsif new.event_type='cancelled'::public.plan_history_event_type
        and new.metadata->>'reason'='replacement_timeout' then
    for v_user_id in
      select pm.user_id from public.plan_memberships pm
      where pm.plan_id=new.plan_id
        and pm.withdrawn_at=new.occurred_at
    loop
      insert into public.notifications(
        user_id,type,title,body,related_plan_id,dedupe_key,created_at
      ) values (
        v_user_id,'plan_replacement_timeout','SIGNAL ENDED',
        'We couldn’t find a replacement in time, so this Plan has ended.',
        new.plan_id,'plan-history:'||new.id::text||':'||v_user_id::text,new.occurred_at
      ) on conflict(user_id,dedupe_key) do nothing;
    end loop;
  end if;

  return new;
end;
$function$;

alter function public.notify_plan_replacement_history() owner to postgres;
revoke all on function public.notify_plan_replacement_history() from public,anon,authenticated;
drop trigger if exists plan_replacement_history_notifications
on public.plan_history;

create trigger plan_replacement_history_notifications
after insert on public.plan_history
for each row
when (
  new.event_type in (
    'recovery_required'::public.plan_history_event_type,
    'member_admitted'::public.plan_history_event_type,
    'recovery_resolved'::public.plan_history_event_type,
    'cancelled'::public.plan_history_event_type
  )
)
execute function public.notify_plan_replacement_history();

commit;
