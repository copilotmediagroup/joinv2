begin;

create or replace function public.withdraw_my_signal_v2(
  p_signal_intent_id uuid
)
returns table (
  signal_intent_id uuid,
  signal_group_id uuid,
  group_state public.signal_group_state,
  remaining_member_count integer,
  activation_threshold integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_group_id uuid;
  v_group_state public.signal_group_state;
  v_remaining integer;
  v_threshold integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_signal_intent_id is null then
    raise exception 'signal_intent_id_required' using errcode='22023';
  end if;

  begin
    return query
    select * from public.withdraw_my_signal(p_signal_intent_id);
    return;
  exception
    when others then
      if sqlerrm <> 'live_signal_assignment_not_found' then
        raise;
      end if;
  end;

  select sgm.signal_group_id,sg.state,gp.activation_threshold
  into v_group_id,v_group_state,v_threshold
  from public.signal_intents si
  join public.signal_group_memberships sgm
    on sgm.originating_signal_intent_id=si.id
   and sgm.user_id=si.user_id
  join public.signal_groups sg on sg.id=sgm.signal_group_id
  join public.grouping_policies gp on gp.id=sg.grouping_policy_id
  where si.id=p_signal_intent_id
    and si.user_id=v_user_id
    and si.state='withdrawn'::public.signal_intent_state
    and sgm.state='withdrawn'::public.signal_group_membership_state
  limit 1;

  if v_group_id is null then
    raise exception 'live_signal_assignment_not_found';
  end if;

  select count(*)::integer
  into v_remaining
  from public.signal_group_memberships sgm
  where sgm.signal_group_id=v_group_id
    and sgm.state in (
      'matched'::public.signal_group_membership_state,
      'confirmed'::public.signal_group_membership_state
    );

  return query select p_signal_intent_id,v_group_id,v_group_state,v_remaining,v_threshold;
end;
$function$;

alter function public.withdraw_my_signal_v2(uuid) owner to postgres;
revoke all on function public.withdraw_my_signal_v2(uuid) from public,anon;
grant execute on function public.withdraw_my_signal_v2(uuid) to authenticated;

revoke execute on function public.withdraw_my_signal(uuid) from authenticated;

comment on function public.withdraw_my_signal_v2(uuid)
is 'Retry-safe authenticated Signal withdrawal. First call delegates to withdraw_my_signal; identical retries recover the caller-owned withdrawn result.';

comment on function public.withdraw_my_signal(uuid)
is 'Legacy Signal withdrawal authority. Browser execution revoked; use withdraw_my_signal_v2.';

commit;
