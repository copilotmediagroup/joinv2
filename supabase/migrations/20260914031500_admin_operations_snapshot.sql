begin;

create index if not exists plans_live_ops_state_idx
on public.plans(state)
where state in (
  'published'::public.plan_state,
  'locked'::public.plan_state,
  'recovery_required'::public.plan_state,
  'active_outing'::public.plan_state
);

create index if not exists account_access_state_active_restriction_idx
on public.account_access_state(restriction,restricted_until)
where restriction in ('suspended','banned');

create or replace function public.get_admin_operations_snapshot()
returns table(
  captured_at timestamptz,
  active_signal_groups bigint,
  forming_signal_groups bigint,
  coordinating_signal_groups bigint,
  signals_expiring_soon bigint,
  live_plans bigint,
  open_user_reports bigint,
  open_moment_reports bigint,
  stale_moderation_claims bigint,
  restricted_accounts bigint
)language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  return query
  select
    now(),
    (select count(*) from public.signal_groups sg
      where sg.state in (
        'forming'::public.signal_group_state,
        'confirming'::public.signal_group_state,
        'coordinating'::public.signal_group_state,
        'locked'::public.signal_group_state,
        'active_outing'::public.signal_group_state
      ) and sg.expires_at>now()),    (select count(*) from public.signal_groups sg
      where sg.state='forming'::public.signal_group_state
        and sg.expires_at>now()),
    (select count(*) from public.signal_groups sg
      where sg.state='coordinating'::public.signal_group_state
        and sg.expires_at>now()),
    (select count(*) from public.signal_groups sg
      where sg.state in (
        'forming'::public.signal_group_state,
        'confirming'::public.signal_group_state,
        'coordinating'::public.signal_group_state,
        'locked'::public.signal_group_state,
        'active_outing'::public.signal_group_state
      )
        and sg.expires_at>now()
        and sg.expires_at<=now()+interval '5 minutes'),
    (select count(*) from public.plans p
      where p.state in (
        'published'::public.plan_state,
        'locked'::public.plan_state,
        'recovery_required'::public.plan_state,
        'active_outing'::public.plan_state
      )),
    (select count(*) from public.user_reports ur
      where ur.state='open'
        and ur.assigned_admin_user_id is null),    (select count(*) from public.signal_moment_reports smr
      where smr.state='open'
        and smr.assigned_admin_user_id is null),
    (
      (select count(*) from public.user_reports ur
        where ur.state='reviewing'
          and ur.claimed_at is not null
          and ur.claimed_at<now()-interval '30 minutes')
      +
      (select count(*) from public.signal_moment_reports smr
        where smr.state='reviewed'
          and smr.claimed_at is not null
          and smr.claimed_at<now()-interval '30 minutes')
    ),
    (select count(*) from public.account_access_state aas
      where aas.restriction='banned'
         or (aas.restriction='suspended'
             and (aas.restricted_until is null or aas.restricted_until>now())));
end;
$function$;

alter function public.get_admin_operations_snapshot() owner to postgres;
revoke all on function public.get_admin_operations_snapshot() from public,anon;
grant execute on function public.get_admin_operations_snapshot() to authenticated;

comment on function public.get_admin_operations_snapshot()
is 'Capability-gated one-row operational pressure snapshot for the moderation console.';

commit;
