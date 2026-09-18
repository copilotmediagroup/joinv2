begin;
drop function if exists public.get_my_signal_completion(uuid);
create function public.get_my_signal_completion(p_plan_id uuid)
returns table(plan_id uuid,activity_name text,venue_name text,city_name text,state_code text,scheduled_starts_at timestamptz,scheduled_ends_at timestamptz,completed_at timestamptz,experience_rating text,participant_count integer,connections_available boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  return query select p.id,a.name,v.name,c.name,s.code,p.scheduled_starts_at,p.scheduled_ends_at,done.completed_at,done.experience_rating,
    (select count(*)::integer from public.plan_memberships pm where pm.plan_id=p.id and pm.membership_state in ('active','completed')),true
  from public.plan_member_outing_completions done join public.plans p on p.id=done.plan_id join public.activities a on a.id=p.activity_id join public.cities c on c.id=p.city_id join public.states s on s.id=c.state_id left join public.venues v on v.id=p.current_venue_id
  where done.plan_id=p_plan_id and done.user_id=v_user_id;
end;$function$;
alter function public.get_my_signal_completion(uuid) owner to postgres;
revoke all on function public.get_my_signal_completion(uuid) from public,anon;
grant execute on function public.get_my_signal_completion(uuid) to authenticated;
commit;
