begin;

-- ============================================================
-- SIGNAL
-- Migration 0043
-- System-earned Signal history / reputation summary
-- ============================================================
-- This intentionally exposes raw system-earned counters rather
-- than inventing subjective reputation labels in the browser.
-- ============================================================

create or replace function public.get_my_signal_history_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_signals integer:=0;
  v_completed integer:=0;
  v_verified_show_ups integer:=0;
  v_last_meetup_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select count(distinct pm.plan_id)::integer
  into v_signals
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  where pm.user_id=v_user_id
    and p.origin='signal'::public.plan_origin
    and pm.membership_state<>'removed'::public.plan_membership_state;

  select
    count(distinct pm.plan_id)::integer,
    max(coalesce(p.completed_at,p.scheduled_starts_at))
  into v_completed,v_last_meetup_at
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  where pm.user_id=v_user_id
    and p.origin='signal'::public.plan_origin
    and p.state='completed'::public.plan_state
    and pm.membership_state<>'removed'::public.plan_membership_state;

  select count(distinct ar.plan_id)::integer
  into v_verified_show_ups
  from public.attendance_records ar
  join public.plans p on p.id=ar.plan_id
  where ar.user_id=v_user_id
    and p.origin='signal'::public.plan_origin
    and ar.evidence_type in (
      'location_supported'::public.attendance_evidence_type,
      'partner_verified'::public.attendance_evidence_type,
      'system_verified'::public.attendance_evidence_type
    );

  return jsonb_build_object(
    'signalsJoined',coalesce(v_signals,0),
    'completedMeetups',coalesce(v_completed,0),
    'verifiedShowUps',coalesce(v_verified_show_ups,0),
    'lastMeetupAt',v_last_meetup_at
  );
end;
$function$;

alter function public.get_my_signal_history_summary() owner to postgres;
revoke all on function public.get_my_signal_history_summary() from public,anon;
grant execute on function public.get_my_signal_history_summary() to authenticated;

commit;
