begin;

create table public.bored_open_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  city_id uuid not null references public.cities(id),
  state text not null default 'open'
    check (state in ('open','converted','cancelled','expired')),
  chosen_activity_id uuid references public.activities(id),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > opened_at)
);

create unique index bored_open_intents_one_open_user_idx
on public.bored_open_intents(user_id) where state='open';

create index bored_open_intents_open_city_idx
on public.bored_open_intents(city_id,expires_at) where state='open';

alter table public.bored_open_intents enable row level security;
revoke all on table public.bored_open_intents from public,anon,authenticated;

create table public.bored_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  bored_intent_id uuid not null references public.bored_open_intents(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  activity_id uuid not null references public.activities(id),  event_type text not null check (event_type in ('offered','passed','accepted')),
  occurred_at timestamptz not null default now()
);

create index bored_opportunity_events_intent_time_idx
on public.bored_opportunity_events(bored_intent_id,occurred_at desc);

alter table public.bored_opportunity_events enable row level security;
revoke all on table public.bored_opportunity_events from public,anon,authenticated;

create or replace function public.get_my_bored_opportunity(
  p_excluded_activity_slugs text[] default array[]::text[]
)
returns table (
  bored_intent_id uuid,
  activity_id uuid,
  activity_slug text,
  activity_name text,
  active_count integer,
  time_window text,
  reason_code text
)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user uuid:=auth.uid();
  v_city uuid;
  v_birth date;
  v_timezone text;
  v_intent uuid;
  v_hour integer;begin
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

  select boi.id into v_intent from public.bored_open_intents boi
  where boi.user_id=v_user and boi.state='open' for update;

  if v_intent is null then
    insert into public.bored_open_intents(user_id,city_id,expires_at)
    values(v_user,v_city,clock_timestamp()+interval '30 minutes')
    returning id into v_intent;
  end if;

  v_hour:=extract(hour from clock_timestamp() at time zone v_timezone)::integer;

  return query
  with recent_activity as (    select distinct p.activity_id
    from public.plan_memberships pm join public.plans p on p.id=pm.plan_id
    where pm.user_id=v_user and p.state='completed'
      and p.completed_at>clock_timestamp()-interval '14 days'
  ), live as (
    select si.activity_id,count(distinct si.user_id)::integer n
    from public.signal_intents si
    where si.city_id=v_city and si.state='active' and si.expires_at>clock_timestamp()
      and si.user_id<>v_user
      and not public.users_have_block_relation(v_user,si.user_id)
    group by si.activity_id
  ), ranked as (
    select a.id,a.slug,a.name,coalesce(l.n,0)::integer n,
      (coalesce(l.n,0)*100
       + case when ra.activity_id is null then 18 else 0 end
       + case
          when v_hour between 6 and 9 and a.slug='chill' then 45
          when v_hour>=22 and a.slug in ('nightlife','drinks','music') then 40
          when v_hour between 17 and 21 and a.slug in ('food','music','chill') then 28
          when v_hour between 10 and 17 and a.slug in ('outdoors','explore','sports') then 24
          else 0 end
      ) score
    from public.activities a
    left join live l on l.activity_id=a.id
    left join recent_activity ra on ra.activity_id=a.id
    where a.is_active=true
      and (a.minimum_age is null or v_birth is not null and
        extract(year from age(current_date,v_birth))::integer>=a.minimum_age)
      and not (a.slug=any(coalesce(p_excluded_activity_slugs,array[]::text[])))
  ), pick as (
    select * from ranked order by score desc,slug limit 1
  )  select v_intent,p.id,p.slug,p.name,p.n,'NOW'::text,
    case when p.n>0 then 'people_active'
         when v_hour between 6 and 9 and p.slug='chill' then 'morning_fit'
         when v_hour>=22 and p.slug in ('nightlife','drinks','music') then 'late_night_fit'
         else 'time_and_novelty_fit' end
  from pick p;

end;
$function$;

alter function public.get_my_bored_opportunity(text[]) owner to postgres;
revoke all on function public.get_my_bored_opportunity(text[]) from public,anon;
grant execute on function public.get_my_bored_opportunity(text[]) to authenticated;

comment on function public.get_my_bored_opportunity(text[])
is 'Creates/resumes a 30-minute open boredom intent and automatically selects a NOW activity from authoritative city, age, live demand, local time, blocks, recent history, and caller exclusions.';

commit;
