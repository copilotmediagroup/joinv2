begin;

create or replace function public.finish_my_plan_outing(p_plan_id uuid)
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
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  -- Match check-in/leave lock order so DONE HERE cannot cross a concurrent
  -- membership withdrawal or Plan terminal transition on stale snapshots.
  select p.* into v_plan
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
  for update;
  if not found or v_membership.membership_state<>'active'::public.plan_membership_state then
    raise exception 'active_plan_membership_required' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.attendance_records ar
    where ar.plan_id=p_plan_id
      and ar.user_id=v_user_id
      and ar.evidence_type='self_reported'::public.attendance_evidence_type
  ) then
    raise exception 'active_signal_check_in_required' using errcode='42501';
  end if;

  if v_plan.state in ('cancelled'::public.plan_state) then
    return true;
  end if;

  -- A completion racing the lifecycle's Plan completion still records the
  -- caller's explicit DONE HERE. The row is one-per-member and retry-safe.
  if v_plan.state not in (
    'locked'::public.plan_state,
    'recovery_required'::public.plan_state,
    'active_outing'::public.plan_state,
    'completed'::public.plan_state
  ) then
    return true;
  end if;

  insert into public.plan_member_outing_completions(plan_id,user_id,completed_at)
  values(p_plan_id,v_user_id,v_now)
  on conflict(plan_id,user_id) do nothing;

  return true;
end;
$function$;

alter function public.finish_my_plan_outing(uuid) owner to postgres;
revoke all on function public.finish_my_plan_outing(uuid) from public,anon;
grant execute on function public.finish_my_plan_outing(uuid) to authenticated;

comment on function public.finish_my_plan_outing(uuid)
is 'Serialized retry-idempotent DONE HERE. Locks Plan then membership, requires caller check-in, and preserves explicit completion across a concurrent Plan lifecycle completion.';

commit;
