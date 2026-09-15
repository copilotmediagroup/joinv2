begin;

alter table public.signal_groups
  add column if not exists journey_stage text not null default 'forming';

alter table public.signal_groups
  drop constraint if exists signal_groups_journey_stage_check;
alter table public.signal_groups
  add constraint signal_groups_journey_stage_check
  check (journey_stage in ('forming','arrival','places','time','plan','active_outing','completed'));

update public.signal_groups sg
set journey_stage = case
  when sg.state='completed' then 'completed'
  when sg.state='active_outing' then 'active_outing'
  when exists(select 1 from public.plans p where p.originating_signal_group_id=sg.id and p.state not in ('cancelled','completed')) then 'plan'
  when exists(select 1 from public.signal_time_rounds str where str.signal_group_id=sg.id) then 'time'
  when exists(select 1 from public.signal_venue_rounds svr where svr.signal_group_id=sg.id) then 'places'
  when sg.state in ('coordinating','locked') then 'arrival'
  else 'forming'
end;

create or replace function public.advance_my_signal_journey_stage(
  p_signal_group_id uuid,
  p_stage text
)
returns text
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_group public.signal_groups%rowtype;
  v_current_rank integer;
  v_requested_rank integer;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_signal_group_id is null then raise exception 'signal_group_id_required' using errcode='22023'; end if;
  if p_stage not in ('arrival','places','time') then raise exception 'invalid_signal_journey_stage' using errcode='22023'; end if;

  select sg.* into v_group from public.signal_groups sg where sg.id=p_signal_group_id for update;
  if not found then raise exception 'signal_group_not_found' using errcode='P0001'; end if;
  if not exists(select 1 from public.signal_group_memberships sgm where sgm.signal_group_id=v_group.id and sgm.user_id=v_user_id and sgm.state in ('matched','confirmed')) then
    raise exception 'signal_membership_required' using errcode='42501';
  end if;
  if v_group.state not in ('coordinating','locked') then
    return v_group.journey_stage;
  end if;

  v_current_rank:=case v_group.journey_stage when 'forming' then 0 when 'arrival' then 1 when 'places' then 2 when 'time' then 3 when 'plan' then 4 when 'active_outing' then 5 when 'completed' then 6 else 0 end;
  v_requested_rank:=case p_stage when 'arrival' then 1 when 'places' then 2 when 'time' then 3 end;

  if v_requested_rank > v_current_rank then
    update public.signal_groups set journey_stage=p_stage,updated_at=clock_timestamp() where id=v_group.id;
    return p_stage;
  end if;
  return v_group.journey_stage;
end;
$function$;

alter function public.advance_my_signal_journey_stage(uuid,text) owner to postgres;
revoke all on function public.advance_my_signal_journey_stage(uuid,text) from public,anon;
grant execute on function public.advance_my_signal_journey_stage(uuid,text) to authenticated;

commit;
