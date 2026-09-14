begin;

create index if not exists cities_active_name_prefix_idx
  on public.cities ((lower(name)) text_pattern_ops, name, id)
  where is_active=true;

create or replace function public.search_onboarding_cities(
  p_query text,
  p_limit integer default 20
)
returns table(
  id uuid,
  city_name text,
  city_slug text,
  state_code text,
  state_name text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_query text:=lower(btrim(coalesce(p_query,'')));
begin
  if char_length(v_query)<2 then
    return;
  end if;
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'invalid_city_search_limit' using errcode='22023';
  end if;

  return query
  select
    c.id,
    c.name,
    c.slug,
    s.code,
    s.name
  from public.cities c
  join public.states s on s.id=c.state_id
  where c.is_active=true
    and s.is_active=true
    and lower(c.name) like v_query || '%'
  order by c.name,c.id
  limit p_limit;
end;
$function$;

alter function public.search_onboarding_cities(text,integer) owner to postgres;
revoke all on function public.search_onboarding_cities(text,integer) from public,anon;
grant execute on function public.search_onboarding_cities(text,integer) to authenticated;

comment on function public.search_onboarding_cities(text,integer)
is 'Bounded authenticated active-city prefix search for onboarding autocomplete.';

commit;
