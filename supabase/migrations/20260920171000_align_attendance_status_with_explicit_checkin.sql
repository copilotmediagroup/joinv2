begin;

-- The live journey uses explicit self-report as the authority for I'M HERE.
-- Keep the attendance status RPC on that same boundary: verification evidence
-- can strengthen attendance reputation, but it cannot press I'M HERE for a user.
create or replace function public.get_my_plan_attendance_status(p_plan_id uuid)
returns jsonb
language plpgsql stable security definer
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
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  select p.* into v_plan from public.plans p where p.id=p_plan_id;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  select pm.* into v_membership from public.plan_memberships pm
  where pm.plan_id=p_plan_id and pm.user_id=v_user_id
    and pm.membership_state='active'::public.plan_membership_state;
  if not found then raise exception 'plan_membership_required' using errcode='42501'; end if;

  if v_plan.scheduled_starts_at is not null then
    v_window_open:=v_plan.scheduled_starts_at-interval '30 minutes';
    v_window_close:=coalesce(v_plan.scheduled_ends_at,v_plan.scheduled_starts_at+interval '90 minutes')+interval '30 minutes';
  end if;

  select min(ar.occurred_at) into v_checked_in_at
  from public.attendance_records ar
  where ar.plan_id=p_plan_id and ar.user_id=v_user_id
    and ar.evidence_type='self_reported'::public.attendance_evidence_type;

  select exists(
    select 1 from public.attendance_records ar
    where ar.plan_id=p_plan_id and ar.user_id=v_user_id
      and ar.evidence_type in (
        'location_supported'::public.attendance_evidence_type,
        'partner_verified'::public.attendance_evidence_type,
        'system_verified'::public.attendance_evidence_type
      )
  ) into v_verified;
  select count(distinct ar.user_id)::integer into v_checked_count
  from public.attendance_records ar
  where ar.plan_id=p_plan_id
    and ar.evidence_type='self_reported'::public.attendance_evidence_type;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=p_plan_id and pm.membership_state='active'::public.plan_membership_state;

  return jsonb_build_object(
    'planId',p_plan_id,'planState',v_plan.state::text,'serverNow',v_now,
    'windowOpensAt',v_window_open,'windowClosesAt',v_window_close,
    'canCheckIn',(v_checked_in_at is null and v_window_open is not null
      and v_now between v_window_open and v_window_close
      and v_plan.state in ('locked','recovery_required','active_outing')),
    'checkedIn',(v_checked_in_at is not null),'checkedInAt',v_checked_in_at,
    'verified',v_verified,'checkedInCount',v_checked_count,'activeMemberCount',v_active_count
  );
end;
$function$;

alter function public.get_my_plan_attendance_status(uuid) owner to postgres;
revoke all on function public.get_my_plan_attendance_status(uuid) from public,anon;
grant execute on function public.get_my_plan_attendance_status(uuid) to authenticated;
comment on function public.get_my_plan_attendance_status(uuid) is
'Returns caller Plan attendance status. checkedIn/checkedInAt/count use explicit self-reported check-in only; verification evidence remains separate.';
commit;
