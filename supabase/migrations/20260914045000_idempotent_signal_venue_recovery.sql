begin;

create or replace function public.recover_my_signal_venue(
  p_signal_group_id uuid,
  p_failed_place_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_group public.signal_groups%rowtype;
  v_winning_place_id text;
  v_failed_place_id text := btrim(p_failed_place_id);
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_signal_group_id is null or nullif(v_failed_place_id, '') is null then
    raise exception 'signal_group_and_failed_place_required' using errcode = '22023';
  end if;
  if p_reason not in ('closed', 'no_eligible_time', 'unavailable') then
    raise exception 'invalid_signal_venue_recovery_reason' using errcode = '22023';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = p_signal_group_id
  for update;
  if not found then
    raise exception 'signal_group_not_found' using errcode = 'P0001';
  end if;
  if v_group.state not in ('locked'::public.signal_group_state, 'coordinating'::public.signal_group_state) then
    raise exception 'signal_group_not_recoverable: %', v_group.state using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_venue_recovery_not_eligible' using errcode = '42501';
  end if;

  select svo.place_id into v_winning_place_id
  from public.signal_venue_rounds svr
  join public.signal_venue_options svo
    on svo.round_id = svr.id and svo.id = svr.winner_option_id
  where svr.signal_group_id = v_group.id and svr.state = 'won'
  order by svr.round_number desc
  limit 1;

  if v_winning_place_id is null then
    if exists (
      select 1 from public.signal_venue_exclusions sve
      where sve.signal_group_id = v_group.id
        and sve.place_id = v_failed_place_id
    ) then
      return true;
    end if;
    raise exception 'signal_venue_winner_not_found' using errcode = 'P0001';
  end if;

  if v_winning_place_id <> v_failed_place_id then
    raise exception 'signal_venue_recovery_place_mismatch' using errcode = 'P0001';
  end if;

  insert into public.signal_venue_exclusions(signal_group_id, place_id, reason, excluded_at)
  values(v_group.id, v_winning_place_id, p_reason, clock_timestamp())
  on conflict (signal_group_id, place_id)
  do update set reason = excluded.reason, excluded_at = excluded.excluded_at;

  delete from public.signal_time_rounds where signal_group_id = v_group.id;
  delete from public.signal_venue_rounds where signal_group_id = v_group.id;
  return true;
end;
$function$;

alter function public.recover_my_signal_venue(uuid,text,text) owner to postgres;
revoke all on function public.recover_my_signal_venue(uuid,text,text) from public,anon;
grant execute on function public.recover_my_signal_venue(uuid,text,text) to authenticated;

comment on function public.recover_my_signal_venue(uuid,text,text)
is 'Idempotent member-authorized venue recovery. A repeated retry for an already-excluded failed venue succeeds without recreating deleted rounds.';

commit;
