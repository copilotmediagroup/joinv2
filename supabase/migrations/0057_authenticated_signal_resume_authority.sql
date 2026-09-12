begin;

create or replace function public.get_my_active_signal_resume()
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
  max_age integer
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
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
    sg.max_age
  from public.signal_intents si
  join public.signal_group_memberships mine
    on mine.originating_signal_intent_id=si.id
   and mine.user_id=v_user_id
   and mine.state in ('matched','confirmed')
  join public.signal_groups sg
    on sg.id=mine.signal_group_id
  join public.grouping_policies gp
    on gp.id=sg.grouping_policy_id
  join public.activities a
    on a.id=sg.activity_id
  where si.user_id=v_user_id
    and si.state='assigned'::public.signal_intent_state
    and sg.state in ('forming','confirming','coordinating','locked')
    and sg.expires_at>clock_timestamp()
  order by sg.updated_at desc,sg.id desc
  limit 1;
end;
$function$;

alter function public.get_my_active_signal_resume() owner to postgres;
revoke all on function public.get_my_active_signal_resume() from public,anon;
grant execute on function public.get_my_active_signal_resume() to authenticated;

commit;
