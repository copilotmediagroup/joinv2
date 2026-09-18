begin;

alter table public.plan_member_outing_completions
  add column if not exists experience_rating text null,
  add column if not exists feedback_at timestamptz null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='plan_member_outing_completions_rating_check'
      and conrelid='public.plan_member_outing_completions'::regclass
  ) then
    alter table public.plan_member_outing_completions
      add constraint plan_member_outing_completions_rating_check
      check (experience_rating is null or experience_rating in ('good','okay','bad'));
  end if;
end $$;

create or replace function public.submit_my_signal_completion_feedback(
  p_plan_id uuid,p_rating text
) returns boolean
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if p_rating not in ('good','okay','bad') then
    raise exception 'invalid_experience_rating' using errcode='22023';
  end if;
  update public.plan_member_outing_completions c
  set experience_rating=p_rating,feedback_at=clock_timestamp()
  where c.plan_id=p_plan_id and c.user_id=v_user_id;
  if not found then
    raise exception 'completed_outing_required' using errcode='42501';
  end if;
  return true;
end;$function$;

revoke all on function public.submit_my_signal_completion_feedback(uuid,text) from public,anon;
grant execute on function public.submit_my_signal_completion_feedback(uuid,text) to authenticated;

drop function if exists public.get_my_signal_completion(uuid);

create function public.get_my_signal_completion(p_plan_id uuid)
returns table(
  plan_id uuid,activity_name text,venue_name text,city_name text,state_code text,
  scheduled_starts_at timestamptz,scheduled_ends_at timestamptz,completed_at timestamptz,
  experience_rating text,participant_count integer,connections_available boolean
)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  return query
  select p.id,a.name,v.name,c.name,s.code,p.scheduled_starts_at,p.scheduled_ends_at,
    done.completed_at,done.experience_rating,
    (select count(*)::integer from public.plan_memberships pm
     where pm.plan_id=p.id and pm.membership_state in ('active','completed')),
    (p.state='completed'::public.plan_state and exists(select 1 from public.plan_memberships mine where mine.plan_id=p.id and mine.user_id=v_user_id and mine.membership_state='completed'::public.plan_membership_state))
  from public.plan_member_outing_completions done
  join public.plans p on p.id=done.plan_id
  join public.activities a on a.id=p.activity_id
  join public.cities c on c.id=p.city_id
  join public.states s on s.id=c.state_id
  left join public.venues v on v.id=p.current_venue_id
  where done.plan_id=p_plan_id and done.user_id=v_user_id;
end;$function$;

alter function public.get_my_signal_completion(uuid) owner to postgres;
revoke all on function public.get_my_signal_completion(uuid) from public,anon;
grant execute on function public.get_my_signal_completion(uuid) to authenticated;

comment on function public.submit_my_signal_completion_feedback(uuid,text)
is 'Stores private product-quality feedback from a member after DONE HERE; it is not a public rating of another member.';
comment on function public.get_my_signal_completion(uuid)
is 'Returns the completion receipt for the caller after DONE HERE without reopening live Signal authority.';

commit;
