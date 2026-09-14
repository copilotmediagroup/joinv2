begin;

create or replace function public.cast_my_signal_venue_vote(
  p_round_id uuid,
  p_option_id uuid
)
returns table (
  vote_accepted boolean,
  round_state text,
  winner_option_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_group public.signal_groups%rowtype;
  v_round public.signal_venue_rounds%rowtype;
  v_option_exists boolean;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_round_id is null or p_option_id is null then
    raise exception 'signal_venue_round_and_option_required' using errcode = '22023';
  end if;

  select svr.signal_group_id into v_group_id
  from public.signal_venue_rounds svr
  where svr.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_venue_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select svr.* into v_round
  from public.signal_venue_rounds svr
  where svr.id = p_round_id
  for update;

  if not exists (
    select 1 from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_venue_vote_not_eligible' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.signal_venue_options svo
    where svo.round_id = v_round.id and svo.id = p_option_id
  ) into v_option_exists;

  if not v_option_exists then
    raise exception 'signal_venue_option_not_in_round' using errcode = '22023';
  end if;

  if v_round.state <> 'open' or clock_timestamp() >= v_round.closes_at then
    perform public.reconcile_signal_venue_round(v_round.id);
    select state, signal_venue_rounds.winner_option_id
    into v_round.state, v_round.winner_option_id
    from public.signal_venue_rounds
    where id = v_round.id;

    if exists (
      select 1
      from public.signal_venue_votes svv
      where svv.round_id = v_round.id
        and svv.user_id = v_user_id
        and svv.option_id = p_option_id
    ) then
      return query select true, v_round.state, v_round.winner_option_id;
    else
      return query select false, v_round.state, v_round.winner_option_id;
    end if;
    return;
  end if;

  insert into public.signal_venue_votes (round_id, user_id, option_id, cast_at, updated_at)
  values (v_round.id, v_user_id, p_option_id, clock_timestamp(), clock_timestamp())
  on conflict (round_id, user_id)
  do update set option_id = excluded.option_id, updated_at = excluded.updated_at;

  perform public.reconcile_signal_venue_round(v_round.id);

  select state, signal_venue_rounds.winner_option_id
  into v_round.state, v_round.winner_option_id
  from public.signal_venue_rounds
  where id = v_round.id;

  return query select true, v_round.state, v_round.winner_option_id;
end;
$function$;

alter function public.cast_my_signal_venue_vote(uuid, uuid) owner to postgres;
revoke all on function public.cast_my_signal_venue_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_my_signal_venue_vote(uuid, uuid) to authenticated;

create or replace function public.submit_my_signal_time_availability(
  p_round_id uuid,
  p_available_option_ids uuid[],
  p_preferred_option_id uuid default null
)
returns table (
  submission_accepted boolean,
  round_state text,
  winner_option_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_group public.signal_groups%rowtype;
  v_round public.signal_time_rounds%rowtype;
  v_invalid_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_round_id is null or p_available_option_ids is null then
    raise exception 'signal_time_round_and_availability_required' using errcode = '22023';
  end if;

  select str.signal_group_id into v_group_id
  from public.signal_time_rounds str
  where str.id = p_round_id;

  if v_group_id is null then
    raise exception 'signal_time_round_not_found' using errcode = 'P0001';
  end if;

  select sg.* into v_group
  from public.signal_groups sg
  where sg.id = v_group_id
  for update;

  select str.* into v_round
  from public.signal_time_rounds str
  where str.id = p_round_id
  for update;

  if not exists (
    select 1
    from public.signal_group_memberships sgm
    where sgm.signal_group_id = v_group.id
      and sgm.user_id = v_user_id
      and sgm.state = 'confirmed'::public.signal_group_membership_state
      and sgm.is_active_core = true
  ) then
    raise exception 'signal_time_submission_not_eligible' using errcode = '42501';
  end if;

  if v_round.state <> 'open' or clock_timestamp() >= v_round.closes_at then
    perform public.reconcile_signal_time_round(v_round.id);
    select state, signal_time_rounds.winner_option_id
    into v_round.state, v_round.winner_option_id
    from public.signal_time_rounds
    where id = v_round.id;

    if exists (
      select 1 from public.signal_time_availability sta
      where sta.round_id = v_round.id and sta.user_id = v_user_id
    )
    and coalesce((
      select array_agg(sta.option_id order by sta.option_id) filter (where sta.available)
      from public.signal_time_availability sta
      where sta.round_id = v_round.id and sta.user_id = v_user_id
    ), '{}'::uuid[]) = array(
      select distinct supplied.option_id
      from unnest(p_available_option_ids) supplied(option_id)
      order by supplied.option_id
    )
    and (
      select sta.option_id
      from public.signal_time_availability sta
      where sta.round_id = v_round.id
        and sta.user_id = v_user_id
        and sta.is_preferred
      order by sta.option_id
      limit 1
    ) is not distinct from p_preferred_option_id then
      return query select true, v_round.state, v_round.winner_option_id;
    else
      return query select false, v_round.state, v_round.winner_option_id;
    end if;
    return;
  end if;

  select count(*)::integer into v_invalid_count
  from unnest(p_available_option_ids) supplied(option_id)
  where not exists (
    select 1 from public.signal_time_options sto
    where sto.round_id = v_round.id and sto.id = supplied.option_id
  );

  if v_invalid_count > 0 then
    raise exception 'signal_time_option_not_in_round' using errcode = '22023';
  end if;

  if p_preferred_option_id is not null
     and not (p_preferred_option_id = any(p_available_option_ids)) then
    raise exception 'signal_time_preferred_option_must_be_available' using errcode = '22023';
  end if;

  insert into public.signal_time_availability (
    round_id, user_id, option_id, available, is_preferred, submitted_at, updated_at
  )
  select
    v_round.id,
    v_user_id,
    sto.id,
    sto.id = any(p_available_option_ids),
    coalesce(sto.id = p_preferred_option_id, false),
    clock_timestamp(),
    clock_timestamp()
  from public.signal_time_options sto
  where sto.round_id = v_round.id
  on conflict (round_id, user_id, option_id)
  do update set
    available = excluded.available,
    is_preferred = excluded.is_preferred,
    submitted_at = excluded.submitted_at,
    updated_at = excluded.updated_at;

  perform public.reconcile_signal_time_round(v_round.id);

  select state, signal_time_rounds.winner_option_id
  into v_round.state, v_round.winner_option_id
  from public.signal_time_rounds
  where id = v_round.id;

  return query select true, v_round.state, v_round.winner_option_id;
end;
$function$;

alter function public.submit_my_signal_time_availability(uuid, uuid[], uuid) owner to postgres;
revoke all on function public.submit_my_signal_time_availability(uuid, uuid[], uuid) from public, anon;
grant execute on function public.submit_my_signal_time_availability(uuid, uuid[], uuid) to authenticated;

comment on function public.cast_my_signal_venue_vote(uuid,uuid) is 'Casts or changes an open venue vote and recovers an identical retry after round resolution.';
comment on function public.submit_my_signal_time_availability(uuid,uuid[],uuid) is 'Submits time availability and recovers an identical retry after round resolution.';

commit;
