begin;

create or replace function public.get_my_active_signal_outing()
returns table (
  plan_id uuid,
  plan_state public.plan_state,
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    p.id,
    p.state,
    p.scheduled_starts_at,
    p.scheduled_ends_at,
    min(ar.occurred_at)
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  join public.attendance_records ar
    on ar.plan_id=p.id
   and ar.user_id=pm.user_id
   and ar.evidence_type='self_reported'::public.attendance_evidence_type
  where pm.user_id=auth.uid()
    and pm.membership_state='active'::public.plan_membership_state
    and p.state in (
      'locked'::public.plan_state,
      'recovery_required'::public.plan_state,
      'active_outing'::public.plan_state
    )
  group by p.id,p.state,p.scheduled_starts_at,p.scheduled_ends_at,p.active_outing_at
  order by
    case when p.state='active_outing'::public.plan_state then 1 else 0 end desc,
    coalesce(p.active_outing_at,p.scheduled_starts_at,p.created_at) desc,
    p.id desc
  limit 1;
$$;

alter function public.get_my_active_signal_outing() owner to postgres;
revoke all on function public.get_my_active_signal_outing() from public,anon;
grant execute on function public.get_my_active_signal_outing() to authenticated;

comment on function public.get_my_active_signal_outing()
is 'Returns the caller only when they have checked into a still-live Signal Plan. This is the authoritative shell gate for Active Outing Mode.';

commit;
