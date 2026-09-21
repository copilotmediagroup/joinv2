begin;

create or replace function public.set_my_plan_location(
  p_plan_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_captured_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_plan public.plans%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_capture timestamptz:=coalesce(p_captured_at,v_now);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'invalid_latitude' using errcode='22023'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'invalid_longitude' using errcode='22023'; end if;
  if p_accuracy_meters is not null and (p_accuracy_meters < 0 or p_accuracy_meters > 50000) then raise exception 'invalid_location_accuracy' using errcode='22023'; end if;
  if v_capture > v_now + interval '2 minutes' or v_capture < v_now - interval '15 minutes' then raise exception 'stale_location_sample' using errcode='22023'; end if;

  select * into v_plan from public.plans where id=p_plan_id;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  if v_plan.state not in ('locked'::public.plan_state,'recovery_required'::public.plan_state,'active_outing'::public.plan_state) then
    raise exception 'plan_location_not_needed' using errcode='P0001';
  end if;
  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id=p_plan_id and pm.user_id=v_user_id and pm.membership_state='active'
  ) then raise exception 'plan_membership_required' using errcode='42501'; end if;

  insert into public.plan_member_locations(plan_id,user_id,latitude,longitude,accuracy_meters,captured_at,expires_at,updated_at)
  values (p_plan_id,v_user_id,p_latitude,p_longitude,p_accuracy_meters,v_capture,
    least(coalesce(v_plan.scheduled_ends_at,v_now+interval '8 hours')+interval '2 hours',v_now+interval '12 hours'),v_now)
  on conflict (plan_id,user_id) do update
  set latitude=excluded.latitude,longitude=excluded.longitude,accuracy_meters=excluded.accuracy_meters,
      captured_at=excluded.captured_at,expires_at=excluded.expires_at,updated_at=v_now;
  return true;
end;$function$;

alter function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) owner to postgres;
revoke all on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) to authenticated;

comment on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz)
is 'Publishes an active members short-lived live location only during current Plan states used by the arrival/live-outing UI.';

commit;
