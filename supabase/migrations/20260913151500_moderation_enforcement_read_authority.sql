create or replace function public.get_user_account_enforcement_summary(
  p_target_user_id uuid
)
returns table(
  restriction text,
  restricted_until timestamptz,
  latest_action text,
  latest_reason text,
  latest_action_at timestamptz
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not (
    public.has_admin_capability(v_admin_user_id,'moderation.review')
    or public.has_admin_capability(v_admin_user_id,'moderation.enforce')
  ) then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  return query
  select
    s.restriction,
    s.restricted_until,
    e.action,
    e.reason,
    e.created_at
  from (select 1) seed
  left join public.account_access_state s
    on s.user_id=p_target_user_id
  left join lateral (
    select ae.action,ae.reason,ae.created_at
    from public.account_enforcements ae
    where ae.user_id=p_target_user_id
    order by ae.created_at desc,ae.id desc
    limit 1
  ) e on true;
end;
$function$;

alter function public.get_user_account_enforcement_summary(uuid) owner to postgres;
revoke all on function public.get_user_account_enforcement_summary(uuid) from public,anon;
grant execute on function public.get_user_account_enforcement_summary(uuid) to authenticated;

comment on function public.get_user_account_enforcement_summary(uuid)
is 'Capability-gated single-user moderation enforcement summary; bounded to one row for case review.';
