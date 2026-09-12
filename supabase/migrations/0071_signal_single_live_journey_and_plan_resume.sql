begin;

create unique index if not exists signal_intents_one_assigned_per_user_idx
on public.signal_intents(user_id)
where state='assigned'::public.signal_intent_state;

drop function if exists public.get_my_active_signal_journey_resume();

create function public.get_my_active_signal_journey_resume()
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
  locked_venue jsonb,
  plan_id uuid
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  return query
  select
    si.id,
    sg.id,
    sg.state,
    (
      select count(*)::integer
      from public.signal_group_memberships members
      where members.signal_group_id=sg.id
        and members.state in ('matched','confirmed')
    ),
    gp.activation_threshold,
    a.slug,
    sg.time_window_code,
    sg.crowd_mode,
    sg.min_age,
    sg.max_age,
    case
      when sg.state='active_outing'::public.signal_group_state and p.id is not null then 'plan'      when exists (
        select 1 from public.signal_time_rounds str
        where str.signal_group_id=sg.id
      ) then 'time'
      when exists (
        select 1 from public.signal_venue_rounds svr
        where svr.signal_group_id=sg.id
          and svr.state in ('open','runoff')
      ) then 'places'
      when exists (
        select 1 from public.signal_venue_rounds svr
        where svr.signal_group_id=sg.id
          and svr.state='won'
          and svr.winner_option_id is not null
      ) then 'time'
      else 'arrival'
    end,
    (
      select svo.payload
      from public.signal_venue_rounds svr
      join public.signal_venue_options svo
        on svo.id=svr.winner_option_id
       and svo.round_id=svr.id
      where svr.signal_group_id=sg.id
        and svr.state='won'
        and svr.winner_option_id is not null      order by svr.round_number desc
      limit 1
    ),
    p.id
  from public.signal_group_memberships mine
  join public.signal_groups sg on sg.id=mine.signal_group_id
  join public.signal_intents si
    on si.id=mine.originating_signal_intent_id
   and si.user_id=v_user_id
  join public.grouping_policies gp on gp.id=sg.grouping_policy_id
  join public.activities a on a.id=sg.activity_id
  left join public.plans p on p.originating_signal_group_id=sg.id
  where mine.user_id=v_user_id
    and mine.state in ('matched','confirmed')
    and sg.state in ('forming','confirming','coordinating','locked','active_outing')
    and sg.expires_at>clock_timestamp()
    and (
      si.state='assigned'::public.signal_intent_state
      or (sg.state='active_outing'::public.signal_group_state and p.id is not null)
    )
  order by
    case when sg.state='active_outing'::public.signal_group_state then 1 else 0 end desc,
    sg.updated_at desc,
    sg.id desc
  limit 1;
end;
$function$;
alter function public.get_my_active_signal_journey_resume() owner to postgres;
revoke all on function public.get_my_active_signal_journey_resume() from public,anon;
grant execute on function public.get_my_active_signal_journey_resume() to authenticated;

commit;