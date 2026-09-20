begin;

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
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_birth_date date;
  v_gender public.profile_gender;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  select up.birth_date,up.gender into v_birth_date,v_gender from public.user_profiles up
  where up.user_id=v_user_id and up.completion_state='complete';
  if not found or v_birth_date is null or v_gender is null then raise exception 'complete_profile_required'; end if;
  if extract(year from age(current_date,v_birth_date))::integer<18 then raise exception 'chill_dating_requires_adult'; end if;
  if p_seeking_gender is null then raise exception 'chill_seeking_gender_required'; end if;
  if p_min_age is null or p_max_age is null or p_min_age<18 or p_max_age>80 or p_min_age>p_max_age then raise exception 'invalid_chill_age_range'; end if;

  -- Seeking gender is an explicit private user choice. Compatibility remains
  -- reciprocal: each person's seeking_gender must equal the other's profile
  -- gender. Do not infer or restrict preference from the caller's own gender.
  insert into public.chill_dating_preferences(user_id,seeking_gender,min_age,max_age,is_enabled,updated_at)
  values(v_user_id,p_seeking_gender,p_min_age,p_max_age,coalesce(p_is_enabled,true),clock_timestamp())
  on conflict(user_id) do update set seeking_gender=excluded.seeking_gender,min_age=excluded.min_age,max_age=excluded.max_age,is_enabled=excluded.is_enabled,updated_at=excluded.updated_at;

  return query select cdp.seeking_gender,cdp.min_age,cdp.max_age,cdp.is_enabled
  from public.chill_dating_preferences cdp where cdp.user_id=v_user_id;
end;
$function$;

revoke all on function public.update_my_chill_dating_preferences(public.profile_gender,integer,integer,boolean) from public;
grant execute on function public.update_my_chill_dating_preferences(public.profile_gender,integer,integer,boolean) to authenticated;
comment on table public.chill_dating_preferences is 'Private explicit opt-in preferences for reciprocal two-person Chill matching. Seeking gender is user-selected and is never inferred from own profile gender.';

commit;
