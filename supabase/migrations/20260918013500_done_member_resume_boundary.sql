begin;

-- DONE HERE is a per-member terminal state for the live outing. The Plan can
-- remain live for everyone else, but this member must not be resumed into its
-- pre-arrival Details surface on the next canonical journey refresh.
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
  locked_venue jsonb,
  plan_id uuid,
  plan_details_opened boolean
)
language plpgsql stable security definer
set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  return query
  with journey_candidates(signal_intent_id,signal_group_id,group_state,member_count,activation_threshold,activity_slug,time_window_code,crowd_mode,min_age,max_age,signal_stage,locked_venue,plan_id,plan_details_opened,priority,sort_at) as (
    select
      null::uuid,sg.id,sg.state,
      (select count(*)::integer from public.plan_memberships cohort
       where cohort.plan_id=p.id and cohort.membership_state='active'::public.plan_membership_state),
      gp.activation_threshold,a.slug,sg.time_window_code,sg.crowd_mode,sg.min_age,sg.max_age,
      'plan'::text,
      (select svo.payload
       from public.signal_venue_rounds svr
       join public.signal_venue_options svo on svo.id=svr.winner_option_id and svo.round_id=svr.id
       where svr.signal_group_id=sg.id and svr.state='won' and svr.winner_option_id is not null
       order by svr.round_number desc limit 1),
      p.id,(pm.live_details_opened_at is not null),1,p.updated_at
    from public.plan_memberships pm
    join public.plans p on p.id=pm.plan_id
    join public.signal_groups sg on sg.id=p.originating_signal_group_id
    join public.grouping_policies gp on gp.id=sg.grouping_policy_id
    join public.activities a on a.id=sg.activity_id
    where pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
      and p.state not in ('cancelled'::public.plan_state,'completed'::public.plan_state)
      and not exists (
        select 1 from public.plan_member_outing_completions done
        where done.plan_id=p.id and done.user_id=v_user_id
      )
    union all

    select
      si.id,sg.id,sg.state,
      (select count(*)::integer from public.signal_group_memberships members
       where members.signal_group_id=sg.id and members.state in ('matched','confirmed')),
      gp.activation_threshold,a.slug,sg.time_window_code,sg.crowd_mode,sg.min_age,sg.max_age,
      sg.journey_stage::text,
      (select svo.payload
       from public.signal_venue_rounds svr
       join public.signal_venue_options svo on svo.id=svr.winner_option_id and svo.round_id=svr.id
       where svr.signal_group_id=sg.id and svr.state='won' and svr.winner_option_id is not null
       order by svr.round_number desc limit 1),
      null::uuid,false,2,sg.updated_at
    from public.signal_group_memberships mine
    join public.signal_groups sg on sg.id=mine.signal_group_id
    join public.signal_intents si on si.id=mine.originating_signal_intent_id and si.user_id=v_user_id
    join public.grouping_policies gp on gp.id=sg.grouping_policy_id
    join public.activities a on a.id=sg.activity_id
    where mine.user_id=v_user_id
      and mine.state in ('matched','confirmed')
      and si.state='assigned'::public.signal_intent_state
      and sg.state in ('forming','confirming','coordinating','locked')
      and sg.expires_at>clock_timestamp()
  )
  select jc.signal_intent_id,jc.signal_group_id,jc.group_state,jc.member_count,
    jc.activation_threshold,jc.activity_slug,jc.time_window_code,jc.crowd_mode,
    jc.min_age,jc.max_age,jc.signal_stage,jc.locked_venue,jc.plan_id,jc.plan_details_opened
  from journey_candidates jc
  order by jc.priority desc,jc.sort_at desc,jc.signal_group_id desc
  limit 1;
end;
$function$;

alter function public.get_my_active_signal_journey_resume() owner to postgres;
revoke all on function public.get_my_active_signal_journey_resume() from public,anon;
grant execute on function public.get_my_active_signal_journey_resume() to authenticated;

comment on function public.get_my_active_signal_journey_resume()
is 'Returns the caller live Signal journey while excluding a Plan after that member has explicitly marked the checked-in outing DONE HERE.';

commit;
