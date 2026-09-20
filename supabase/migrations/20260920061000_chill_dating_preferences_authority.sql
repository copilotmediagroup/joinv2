begin;

create table public.chill_dating_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seeking_gender public.profile_gender not null,
  min_age integer not null default 18 check (min_age between 18 and 80),
  max_age integer not null default 80 check (max_age between 18 and 80),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint chill_dating_preferences_age_range_check check (min_age <= max_age)
);

alter table public.chill_dating_preferences enable row level security;

revoke all on table public.chill_dating_preferences from anon, authenticated;

create or replace function public.get_my_chill_dating_preferences()
returns table (
  seeking_gender public.profile_gender,
  min_age integer,
  max_age integer,
  is_enabled boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cdp.seeking_gender, cdp.min_age, cdp.max_age, cdp.is_enabled
  from public.chill_dating_preferences cdp
  where cdp.user_id = auth.uid();
$$;

create or replace function public.update_my_chill_dating_preferences(
  p_seeking_gender public.profile_gender,
  p_min_age integer,
  p_max_age integer,
  p_is_enabled boolean default true
)
returns table (
  seeking_gender public.profile_gender,
  min_age integer,
  max_age integer,
  is_enabled boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_birth_date date;
  v_gender public.profile_gender;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  select up.birth_date, up.gender
  into v_birth_date, v_gender
  from public.user_profiles up
  where up.user_id = v_user_id
    and up.completion_state = 'complete';

  if not found or v_birth_date is null or v_gender is null then
    raise exception 'complete_profile_required';
  end if;

  if extract(year from age(current_date, v_birth_date))::integer < 18 then
    raise exception 'chill_dating_requires_adult';
  end if;

  if p_seeking_gender is null then
    raise exception 'chill_seeking_gender_required';
  end if;

  -- Product contract: Chill dating is reciprocal man/woman matching.
  if p_seeking_gender = v_gender then
    raise exception 'chill_requires_opposite_gender_preference';
  end if;

  if p_min_age is null or p_max_age is null
     or p_min_age < 18 or p_max_age > 80 or p_min_age > p_max_age then
    raise exception 'invalid_chill_age_range';
  end if;

  insert into public.chill_dating_preferences (
    user_id, seeking_gender, min_age, max_age, is_enabled, updated_at
  )
  values (
    v_user_id, p_seeking_gender, p_min_age, p_max_age, coalesce(p_is_enabled, true), clock_timestamp()
  )
  on conflict (user_id) do update
  set seeking_gender = excluded.seeking_gender,
      min_age = excluded.min_age,
      max_age = excluded.max_age,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at;

  return query
  select cdp.seeking_gender, cdp.min_age, cdp.max_age, cdp.is_enabled
  from public.chill_dating_preferences cdp
  where cdp.user_id = v_user_id;
end;
$$;

revoke all on function public.get_my_chill_dating_preferences() from public;
revoke all on function public.update_my_chill_dating_preferences(public.profile_gender, integer, integer, boolean) from public;
grant execute on function public.get_my_chill_dating_preferences() to authenticated;
grant execute on function public.update_my_chill_dating_preferences(public.profile_gender, integer, integer, boolean) to authenticated;

comment on table public.chill_dating_preferences is
'Private explicit opt-in dating preferences for two-person Chill matching. Never infer seeking gender from profile gender.';

commit;
