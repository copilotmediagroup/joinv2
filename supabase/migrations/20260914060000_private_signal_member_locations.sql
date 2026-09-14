begin;

create table if not exists public.signal_member_locations (
  signal_group_id uuid not null references public.signal_groups(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision null,
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (signal_group_id,user_id),
  constraint signal_member_locations_lat_check check (latitude between -90 and 90),
  constraint signal_member_locations_lng_check check (longitude between -180 and 180),
  constraint signal_member_locations_accuracy_check check (accuracy_meters is null or accuracy_meters between 0 and 50000),
  constraint signal_member_locations_expiry_check check (expires_at > captured_at)
);

create index if not exists signal_member_locations_active_idx
  on public.signal_member_locations(signal_group_id,expires_at,user_id);

alter table public.signal_member_locations enable row level security;
revoke all on table public.signal_member_locations from public,anon,authenticated;
grant all on table public.signal_member_locations to service_role;

create or replace function public.set_my_signal_location(
  p_signal_group_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_captured_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_group public.signal_groups%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_capture timestamptz:=coalesce(p_captured_at,v_now);
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'invalid_latitude' using errcode='22023'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'invalid_longitude' using errcode='22023'; end if;
  if p_accuracy_meters is not null and (p_accuracy_meters < 0 or p_accuracy_meters > 50000) then raise exception 'invalid_location_accuracy' using errcode='22023'; end if;
  if v_capture > v_now + interval '2 minutes' or v_capture < v_now - interval '15 minutes' then raise exception 'stale_location_sample' using errcode='22023'; end if;

  select * into v_group from public.signal_groups where id=p_signal_group_id;
  if not found then raise exception 'signal_group_not_found' using errcode='P0001'; end if;
  if v_group.state not in ('locked','coordinating') then raise exception 'signal_location_not_needed' using errcode='P0001'; end if;
  if not exists (
    select 1 from public.signal_group_memberships sgm
    where sgm.signal_group_id=p_signal_group_id
      and sgm.user_id=v_user_id
      and sgm.state='confirmed'
      and sgm.is_active_core=true
  ) then raise exception 'signal_membership_required' using errcode='42501'; end if;

  insert into public.signal_member_locations(
    signal_group_id,user_id,latitude,longitude,accuracy_meters,captured_at,expires_at,updated_at
  ) values (
    p_signal_group_id,v_user_id,p_latitude,p_longitude,p_accuracy_meters,v_capture,
    least(v_group.expires_at,v_now+interval '45 minutes'),v_now
  )
  on conflict (signal_group_id,user_id) do update set
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    accuracy_meters=excluded.accuracy_meters,
    captured_at=excluded.captured_at,
    expires_at=excluded.expires_at,
    updated_at=v_now;

  return true;
end;
$function$;

alter function public.set_my_signal_location(uuid,double precision,double precision,double precision,timestamptz) owner to postgres;
revoke all on function public.set_my_signal_location(uuid,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.set_my_signal_location(uuid,double precision,double precision,double precision,timestamptz) to authenticated;

comment on table public.signal_member_locations is 'Private, short-lived device coordinates for active Signal venue fairness. Not browser-readable and deleted with the Signal group.';
comment on function public.set_my_signal_location(uuid,double precision,double precision,double precision,timestamptz) is 'Lets an active confirmed Signal member submit only their own recent location for private group venue ranking.';

commit;
