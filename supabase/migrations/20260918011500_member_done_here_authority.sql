begin;

create table if not exists public.plan_member_outing_completions (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  completed_at timestamptz not null default clock_timestamp(),
  primary key (plan_id,user_id)
);
alter table public.plan_member_outing_completions enable row level security;
revoke all on table public.plan_member_outing_completions from public,anon,authenticated;
grant all on table public.plan_member_outing_completions to service_role;

create or replace function public.finish_my_plan_outing(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from public.plan_memberships pm where pm.plan_id=p_plan_id and pm.user_id=v_user_id and pm.membership_state='active'::public.plan_membership_state) then
    raise exception 'active_plan_membership_required' using errcode='42501';
  end if;
  if not exists(select 1 from public.attendance_records ar where ar.plan_id=p_plan_id and ar.user_id=v_user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type) then
    raise exception 'active_signal_check_in_required' using errcode='42501';
  end if;
  if not exists(select 1 from public.plans p where p.id=p_plan_id and p.state in ('locked','recovery_required','active_outing')) then
    return true;
  end if;
  insert into public.plan_member_outing_completions(plan_id,user_id,completed_at)
  values(p_plan_id,v_user_id,v_now) on conflict(plan_id,user_id) do nothing;
  return true;
end;$function$;
revoke all on function public.finish_my_plan_outing(uuid) from public,anon;
grant execute on function public.finish_my_plan_outing(uuid) to authenticated;
comment on function public.finish_my_plan_outing(uuid) is 'Ends Active Outing Mode for the checked-in caller without withdrawing them from the completed Signal history or ending other members sessions.';
create or replace function public.get_my_active_signal_outing()
returns table(plan_id uuid,plan_state public.plan_state,scheduled_starts_at timestamptz,scheduled_ends_at timestamptz,checked_in_at timestamptz)
language sql stable security definer set search_path=public,pg_temp
as $$
  select p.id,p.state,p.scheduled_starts_at,p.scheduled_ends_at,min(ar.occurred_at)
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  join public.attendance_records ar on ar.plan_id=p.id and ar.user_id=pm.user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type
  where pm.user_id=auth.uid()
    and pm.membership_state='active'::public.plan_membership_state
    and p.state in ('locked'::public.plan_state,'recovery_required'::public.plan_state,'active_outing'::public.plan_state)
    and not exists(select 1 from public.plan_member_outing_completions c where c.plan_id=p.id and c.user_id=pm.user_id)
  group by p.id,p.state,p.scheduled_starts_at,p.scheduled_ends_at,p.active_outing_at
  order by case when p.state='active_outing'::public.plan_state then 1 else 0 end desc,
    coalesce(p.active_outing_at,p.scheduled_starts_at,p.created_at) desc,p.id desc
  limit 1;
$$;
revoke all on function public.get_my_active_signal_outing() from public,anon;
grant execute on function public.get_my_active_signal_outing() to authenticated;
comment on function public.get_my_active_signal_outing() is 'Returns the caller only when checked into a still-live Signal Plan and they have not marked their outing done.';

commit;
