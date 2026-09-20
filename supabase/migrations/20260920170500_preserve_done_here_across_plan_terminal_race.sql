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

  -- DONE HERE is member-owned historical truth. Once an active member actually
  -- checked in, preserve their explicit completion even when Plan completion or
  -- cancellation won the Plan row lock immediately before this transaction.
  -- This keeps the completion receipt authoritative instead of returning success
  -- without the row that get_my_signal_completion requires.
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
is 'Serialized retry-idempotent DONE HERE. Locks Plan then membership, requires active membership plus caller check-in, and preserves explicit member completion across concurrent Plan terminal transitions.';

commit;
