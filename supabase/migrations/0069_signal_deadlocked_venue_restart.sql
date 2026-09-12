begin;

create or replace function public.restart_my_deadlocked_signal_venue_vote(
  p_signal_group_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_group public.signal_groups%rowtype;
  v_latest_state text;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;

  if not found then
    raise exception 'signal_group_not_found' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_venue_restart_not_eligible' using errcode = '42501';
  end if;

  select svr.state into v_latest_state
  from public.signal_venue_rounds svr
  where svr.signal_group_id = v_group.id
  order by svr.round_number desc
  limit 1
  for update;

  if v_latest_state is distinct from 'deadlocked' then
    return false;
  end if;

  if exists (
    select 1 from public.signal_time_rounds str
    where str.signal_group_id = v_group.id
  ) then
    raise exception 'signal_time_round_already_exists' using errcode = 'P0001';
  end if;
  delete from public.signal_venue_rounds
  where signal_group_id = v_group.id;

  return true;
end;
$function$;

alter function public.restart_my_deadlocked_signal_venue_vote(uuid) owner to postgres;
revoke all on function public.restart_my_deadlocked_signal_venue_vote(uuid) from public, anon;
grant execute on function public.restart_my_deadlocked_signal_venue_vote(uuid) to authenticated;

commit;
