begin;

-- Venue/time coordination is intentionally fast: every decision round is 10 seconds.
do $migration$
declare
  v_sql text;
begin
  select pg_get_functiondef('public.ensure_signal_venue_round(uuid,jsonb)'::regprocedure) into v_sql;
  if position('10 minutes' in v_sql) = 0 then
    raise exception 'ensure_signal_venue_round expected 10-minute contract not found';
  end if;
  execute replace(v_sql, '10 minutes', '10 seconds');

  select pg_get_functiondef('public.reconcile_signal_venue_round(uuid)'::regprocedure) into v_sql;
  if position('5 minutes' in v_sql) = 0 then
    raise exception 'reconcile_signal_venue_round expected 5-minute runoff contract not found';
  end if;
  execute replace(v_sql, '5 minutes', '10 seconds');

  select pg_get_functiondef('public.ensure_signal_time_round(uuid,jsonb)'::regprocedure) into v_sql;
  if position('5 minutes' in v_sql) = 0 then
    raise exception 'ensure_signal_time_round expected 5-minute contract not found';
  end if;
  execute replace(v_sql, '5 minutes', '10 seconds');
  select pg_get_functiondef('public.submit_my_signal_time_availability(uuid,uuid[],uuid)'::regprocedure) into v_sql;
  if position('sto.id = p_preferred_option_id' in v_sql) = 0 then
    raise exception 'submit_my_signal_time_availability expected preference expression not found';
  end if;
  execute replace(
    v_sql,
    'sto.id = p_preferred_option_id,',
    'coalesce(sto.id = p_preferred_option_id, false),'
  );
end
$migration$;

update public.signal_venue_rounds
set closes_at = least(closes_at, clock_timestamp() + interval '10 seconds'),
    updated_at = clock_timestamp()
where state = 'open'
  and closes_at > clock_timestamp() + interval '10 seconds';

update public.signal_time_rounds
set closes_at = least(closes_at, clock_timestamp() + interval '10 seconds'),
    updated_at = clock_timestamp()
where state = 'open'
  and closes_at > clock_timestamp() + interval '10 seconds';

-- Rehydrate the browser at the exact authoritative live stage.
create or replace function public.get_my_active_signal_journey_resume()
returns table (
  signal_intent_id uuid,
  signal_group_id uuid,
  group_state public.signal_group_state,
  member_count integer,
  activation_threshold integer,
  activity_slug text,
  time_window_code text,
  crowd_mode public.crowd_mode,
  min_age integer,
  max_age integer,
  signal_stage text,
  locked_venue jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  return query
  select
    si.id,
    sg.id,
    sg.state,
    (
      select count(*)::integer
      from public.signal_group_memberships members
      where members.signal_group_id = sg.id
        and members.state in ('matched','confirmed')
    ),
    gp.activation_threshold,
    a.slug,
    sg.time_window_code,
    sg.crowd_mode,
    sg.min_age,
    sg.max_age,
    case
      when exists (
        select 1 from public.signal_time_rounds str
        where str.signal_group_id = sg.id
      ) then 'time'
      when exists (
        select 1 from public.signal_venue_rounds svr
        where svr.signal_group_id = sg.id
          and svr.state in ('open','runoff')
      ) then 'places'
      when exists (
        select 1 from public.signal_venue_rounds svr
        where svr.signal_group_id = sg.id
          and svr.state = 'won'
          and svr.winner_option_id is not null
      ) then 'time'
      else 'arrival'
    end,
    (
      select svo.payload
      from public.signal_venue_rounds svr
      join public.signal_venue_options svo
        on svo.id = svr.winner_option_id
       and svo.round_id = svr.id
      where svr.signal_group_id = sg.id
        and svr.state = 'won'
        and svr.winner_option_id is not null
      order by svr.round_number desc
      limit 1
    )
  from public.signal_intents si
  join public.signal_group_memberships mine
    on mine.originating_signal_intent_id = si.id
   and mine.user_id = v_user_id
   and mine.state in ('matched','confirmed')
  join public.signal_groups sg on sg.id = mine.signal_group_id
  join public.grouping_policies gp on gp.id = sg.grouping_policy_id
  join public.activities a on a.id = sg.activity_id
  where si.user_id = v_user_id
    and si.state = 'assigned'::public.signal_intent_state
    and sg.state in ('forming','confirming','coordinating','locked','active_outing')
    and sg.expires_at > clock_timestamp()
  order by sg.updated_at desc, sg.id desc
  limit 1;
end;
$function$;

alter function public.get_my_active_signal_journey_resume() owner to postgres;
revoke all on function public.get_my_active_signal_journey_resume() from public, anon;
grant execute on function public.get_my_active_signal_journey_resume() to authenticated;

commit;
