begin;

create or replace function public.get_my_bored_opportunity(
  p_excluded_activity_slugs text[] default array[]::text[]
)
returns table (
  bored_intent_id uuid, activity_id uuid, activity_slug text,
  activity_name text, active_count integer, time_window text, reason_code text
)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user uuid:=auth.uid(); v_city uuid; v_birth date; v_timezone text;
  v_intent uuid; v_hour integer; v_previous_activity uuid;
  v_pick_id uuid; v_pick_slug text; v_pick_name text;
  v_pick_active integer; v_pick_reason text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','bored_open_intent_user_v1',v_user::text),0
  ));

  select up.home_city_id,up.birth_date,coalesce(c.timezone_name,'UTC')
  into v_city,v_birth,v_timezone
  from public.user_profiles up join public.cities c on c.id=up.home_city_id
  where up.user_id=v_user and up.completion_state='complete' and c.is_active=true;
  if v_city is null then raise exception 'complete_profile_with_active_city_required' using errcode='P0001'; end if;

  update public.bored_open_intents
  set state='expired',updated_at=clock_timestamp()
  where user_id=v_user and state='open' and expires_at<=clock_timestamp();

  select boi.id,boi.chosen_activity_id into v_intent,v_previous_activity
  from public.bored_open_intents boi
  where boi.user_id=v_user and boi.state='open' for update;

  if v_intent is null then
    insert into public.bored_open_intents(user_id,city_id,expires_at)
    values(v_user,v_city,clock_timestamp()+interval '30 minutes')
    returning id into v_intent;
  elsif v_previous_activity is not null and exists (
    select 1 from public.activities a
    where a.id=v_previous_activity
      and a.slug=any(coalesce(p_excluded_activity_slugs,array[]::text[]))
  ) then
    insert into public.bored_opportunity_events(
      bored_intent_id,user_id,activity_id,event_type
    ) values(v_intent,v_user,v_previous_activity,'passed');
  end if;

  v_hour:=extract(hour from clock_timestamp() at time zone v_timezone)::integer;

  with recent_activity as (
    select distinct p.activity_id
    from public.plan_memberships pm join public.plans p on p.id=pm.plan_id
    where pm.user_id=v_user and p.state='completed'
      and p.completed_at>clock_timestamp()-interval '14 days'
  ), live_signal as (
    select si.activity_id,count(distinct si.user_id)::integer n
    from public.signal_intents si
    where si.city_id=v_city and si.state='active' and si.expires_at>clock_timestamp()
      and si.user_id<>v_user and not public.users_have_block_relation(v_user,si.user_id)
    group by si.activity_id
  ), bored_pool as (
    select boi.chosen_activity_id activity_id,count(*)::integer n
    from public.bored_open_intents boi
    where boi.city_id=v_city and boi.state='open'
      and boi.expires_at>clock_timestamp() and boi.user_id<>v_user
      and boi.chosen_activity_id is not null
      and not public.users_have_block_relation(v_user,boi.user_id)
    group by boi.chosen_activity_id
  ), ranked as (
    select a.id,a.slug,a.name,
      (coalesce(ls.n,0)+coalesce(bp.n,0))::integer active_n,
      (coalesce(ls.n,0)*100 + coalesce(bp.n,0)*110
       + case when ra.activity_id is null then 18 else 0 end
       + case
          when v_hour between 6 and 9 and a.slug='chill' then 45
          when v_hour>=22 and a.slug in ('nightlife','drinks','music') then 40
          when v_hour between 17 and 21 and a.slug in ('food','music','chill') then 28
          when v_hour between 10 and 17 and a.slug in ('outdoors','explore','sports') then 24
          else 0 end) score
    from public.activities a
    left join live_signal ls on ls.activity_id=a.id
    left join bored_pool bp on bp.activity_id=a.id
    left join recent_activity ra on ra.activity_id=a.id
    where a.is_active=true
      and nullif(btrim(a.grouping_policy_code),'') is not null
      and exists (
        select 1
        from public.grouping_policies gp
        where gp.code=a.grouping_policy_code and gp.is_active=true
      )
      and (a.minimum_age is null or v_birth is not null and
        extract(year from age(current_date,v_birth))::integer>=a.minimum_age)
      and not (a.slug=any(coalesce(p_excluded_activity_slugs,array[]::text[])))
  )
  select r.id,r.slug,r.name,r.active_n,
    case when r.active_n>0 then 'people_active'
         when v_hour between 6 and 9 and r.slug='chill' then 'morning_fit'
         when v_hour>=22 and r.slug in ('nightlife','drinks','music') then 'late_night_fit'
         else 'time_and_novelty_fit' end
  into v_pick_id,v_pick_slug,v_pick_name,v_pick_active,v_pick_reason
  from ranked r order by r.score desc,r.slug limit 1;

  if v_pick_id is null then return; end if;

  update public.bored_open_intents
  set chosen_activity_id=v_pick_id,updated_at=clock_timestamp()
  where id=v_intent;

  insert into public.bored_opportunity_events(
    bored_intent_id,user_id,activity_id,event_type
  ) values(v_intent,v_user,v_pick_id,'offered');

  return query select v_intent,v_pick_id,v_pick_slug,v_pick_name,
    v_pick_active,'NOW'::text,v_pick_reason;
end;
$function$;

alter function public.get_my_bored_opportunity(text[]) owner to postgres;
revoke all on function public.get_my_bored_opportunity(text[]) from public,anon;
grant execute on function public.get_my_bored_opportunity(text[]) to authenticated;

comment on function public.get_my_bored_opportunity(text[])
is 'Automated NOW opportunity engine. Only activities that can pass authoritative Signal formation policy resolution are eligible.';

commit;
