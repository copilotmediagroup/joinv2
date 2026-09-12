begin;

-- ============================================================
-- SIGNAL
-- Migration 0044
-- MY ENERGY + My Kind of Night profile preferences
-- ============================================================

create table if not exists public.profile_signal_preferences (
  user_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  social_energy text,
  going_out_style text,
  night_timing text,
  venue_energy text,
  bar_style text,
  restaurant_style text,
  planning_style text,
  group_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_signal_preferences_social_energy_check check (
    social_energy is null or social_energy in (
      'life_of_party','social','laid_back','reserved_at_first','go_with_flow'
    )
  ),
  constraint profile_signal_preferences_going_out_style_check check (
    going_out_style is null or going_out_style in ('dress_up','casual','either')
  ),
  constraint profile_signal_preferences_night_timing_check check (
    night_timing is null or night_timing in ('early_evening','late_night','either')
  ),
  constraint profile_signal_preferences_venue_energy_check check (
    venue_energy is null or venue_energy in ('rooftop','nightclub','either')
  ),
  constraint profile_signal_preferences_bar_style_check check (
    bar_style is null or bar_style in ('sports_bar','cocktail_bar','either')
  ),
  constraint profile_signal_preferences_restaurant_style_check check (
    restaurant_style is null or restaurant_style in ('nice_restaurant','hidden_gem','either')
  ),
  constraint profile_signal_preferences_planning_style_check check (
    planning_style is null or planning_style in ('planned','spontaneous','either')
  ),
  constraint profile_signal_preferences_group_size_check check (
    group_size is null or group_size in ('small_group','big_group','either')
  )
);

alter table public.profile_signal_preferences enable row level security;
revoke all on table public.profile_signal_preferences from anon,authenticated;

create or replace function public.get_my_signal_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_row public.profile_signal_preferences%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  select p.* into v_row
  from public.profile_signal_preferences p
  where p.user_id=v_user_id;

  return jsonb_build_object(
    'socialEnergy',v_row.social_energy,
    'goingOutStyle',v_row.going_out_style,
    'nightTiming',v_row.night_timing,
    'venueEnergy',v_row.venue_energy,
    'barStyle',v_row.bar_style,
    'restaurantStyle',v_row.restaurant_style,
    'planningStyle',v_row.planning_style,
    'groupSize',v_row.group_size
  );
end;
$function$;

create or replace function public.update_my_signal_preferences(
  p_social_energy text,
  p_going_out_style text,
  p_night_timing text,
  p_venue_energy text,
  p_bar_style text,
  p_restaurant_style text,
  p_planning_style text,
  p_group_size text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  insert into public.profile_signal_preferences(
    user_id,social_energy,going_out_style,night_timing,venue_energy,
    bar_style,restaurant_style,planning_style,group_size,created_at,updated_at
  ) values (
    v_user_id,p_social_energy,p_going_out_style,p_night_timing,p_venue_energy,
    p_bar_style,p_restaurant_style,p_planning_style,p_group_size,clock_timestamp(),clock_timestamp()
  )
  on conflict (user_id) do update set
    social_energy=excluded.social_energy,
    going_out_style=excluded.going_out_style,
    night_timing=excluded.night_timing,
    venue_energy=excluded.venue_energy,
    bar_style=excluded.bar_style,
    restaurant_style=excluded.restaurant_style,
    planning_style=excluded.planning_style,
    group_size=excluded.group_size,
    updated_at=clock_timestamp();

  return public.get_my_signal_preferences();
end;
$function$;

alter function public.get_my_signal_preferences() owner to postgres;
alter function public.update_my_signal_preferences(text,text,text,text,text,text,text,text) owner to postgres;
revoke all on function public.get_my_signal_preferences() from public,anon;
revoke all on function public.update_my_signal_preferences(text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.get_my_signal_preferences() to authenticated;
grant execute on function public.update_my_signal_preferences(text,text,text,text,text,text,text,text) to authenticated;

commit;
