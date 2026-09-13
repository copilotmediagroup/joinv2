begin;

-- Repeated Leave Plan requests from stale tabs/devices must converge safely.
create or replace function public.leave_my_plan(p_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_plan public.plans%rowtype;
  v_membership public.plan_memberships%rowtype;
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select p.* into v_plan
  from public.plans p
  where p.id=p_plan_id
  for update;

  if not found then
    raise exception 'plan_not_found' using errcode='P0001';
  end if;

  select pm.* into v_membership
  from public.plan_memberships pm
  where pm.plan_id=v_plan.id
    and pm.user_id=v_user_id
  for update;

  if not found then
    raise exception 'plan_membership_required' using errcode='P0001';
  end if;

  -- A repeated request after this user already left is a successful no-op.
  if v_membership.membership_state <> 'active'::public.plan_membership_state then
    return true;
  end if;

  if v_plan.state in (
    'completed'::public.plan_state,
    'cancelled'::public.plan_state
  ) then
    return true;
  end if;

  update public.plan_memberships
  set membership_state='withdrawn',
      withdrawn_at=v_now,
      locked_member=false,
      updated_at=v_now
  where id=v_membership.id;

  select c.id into v_conversation_id
  from public.conversations c
  where c.plan_id=v_plan.id;

  if v_conversation_id is not null then
    update public.conversation_membership_intervals
    set ended_at=v_now
    where conversation_id=v_conversation_id
      and user_id=v_user_id
      and ended_at is null;
  end if;

  insert into public.plan_history(
    plan_id,event_type,actor_user_id,reason,metadata,occurred_at
  ) values (
    v_plan.id,'member_withdrew',v_user_id,'Member left Plan',
    jsonb_build_object('source','leave_my_plan'),v_now
  );

  perform public.reconcile_plan_replacement_window(v_plan.id);
  return true;
end;
$function$;

alter function public.leave_my_plan(uuid) owner to postgres;
revoke all on function public.leave_my_plan(uuid) from public,anon;
grant execute on function public.leave_my_plan(uuid) to authenticated;

comment on function public.leave_my_plan(uuid)
is 'Withdraws the caller from an active Plan exactly once; repeated stale-tab departures converge as successful no-ops.';

commit;
