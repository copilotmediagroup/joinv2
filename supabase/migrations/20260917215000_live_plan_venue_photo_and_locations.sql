begin;

create table if not exists public.plan_member_locations (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision null,
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (plan_id,user_id),
  constraint plan_member_locations_lat_check check (latitude between -90 and 90),
  constraint plan_member_locations_lng_check check (longitude between -180 and 180),
  constraint plan_member_locations_accuracy_check check (accuracy_meters is null or accuracy_meters between 0 and 50000),
  constraint plan_member_locations_expiry_check check (expires_at > captured_at)
);

create index if not exists plan_member_locations_active_idx
  on public.plan_member_locations(plan_id,expires_at,user_id);

alter table public.plan_member_locations enable row level security;
revoke all on table public.plan_member_locations from public,anon,authenticated;
grant all on table public.plan_member_locations to service_role;
create or replace function public.set_my_plan_location(
  p_plan_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_captured_at timestamptz default clock_timestamp()
)
returns boolean language plpgsql security definer set search_path=public,pg_temp
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
  if v_plan.state not in ('locked','active') then raise exception 'plan_location_not_needed' using errcode='P0001'; end if;
  if not exists (select 1 from public.plan_memberships pm where pm.plan_id=p_plan_id and pm.user_id=v_user_id and pm.membership_state='active') then raise exception 'plan_membership_required' using errcode='42501'; end if;
  insert into public.plan_member_locations(plan_id,user_id,latitude,longitude,accuracy_meters,captured_at,expires_at,updated_at)
  values (p_plan_id,v_user_id,p_latitude,p_longitude,p_accuracy_meters,v_capture,
    least(coalesce(v_plan.scheduled_ends_at,v_now+interval '8 hours')+interval '2 hours',v_now+interval '12 hours'),v_now)
  on conflict (plan_id,user_id) do update set
    latitude=excluded.latitude,longitude=excluded.longitude,accuracy_meters=excluded.accuracy_meters,
    captured_at=excluded.captured_at,expires_at=excluded.expires_at,updated_at=v_now;
  return true;
end;
$function$;

alter function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) owner to postgres;
revoke all on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) to authenticated;

create or replace function public.get_my_plan_member_locations(p_plan_id uuid)
returns table(user_id uuid,display_name text,avatar_path text,latitude double precision,longitude double precision,accuracy_meters double precision,captured_at timestamptz,is_me boolean)
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists (select 1 from public.plan_memberships pm where pm.plan_id=p_plan_id and pm.user_id=v_user_id and pm.membership_state='active') then raise exception 'plan_membership_required' using errcode='42501'; end if;
  return query select l.user_id,coalesce(up.display_name,'SIGNAL member'),up.avatar_path,l.latitude,l.longitude,l.accuracy_meters,l.captured_at,l.user_id=v_user_id
  from public.plan_member_locations l join public.plan_memberships pm on pm.plan_id=l.plan_id and pm.user_id=l.user_id join public.user_profiles up on up.user_id=l.user_id
  where l.plan_id=p_plan_id and l.expires_at>clock_timestamp() and pm.membership_state='active';
end;
$function$;
alter function public.get_my_plan_member_locations(uuid) owner to postgres;
revoke all on function public.get_my_plan_member_locations(uuid) from public,anon;
grant execute on function public.get_my_plan_member_locations(uuid) to authenticated;

comment on table public.plan_member_locations is
  'Private short-lived active Plan coordinates visible only through membership-authorized RPC output.';
comment on function public.set_my_plan_location(uuid,double precision,double precision,double precision,timestamptz) is
  'Stores only the authenticated active Plan member own recent device location.';
comment on function public.get_my_plan_member_locations(uuid) is
  'Returns unexpired live locations for active members of a Plan only to another active member of that Plan.';

create or replace function public.get_my_plan_governance(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_plan public.plans%rowtype;
  v_active_count integer;
  v_conversation_id uuid;
  v_join jsonb;
  v_change jsonb;
  v_activity_name text;
  v_city_name text;
  v_state_code text;
  v_venue_name text;
  v_venue_address text;
  v_venue_latitude numeric;
  v_venue_longitude numeric;
  v_venue_photo_url text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_plan_id is null then raise exception 'plan_id_required' using errcode='22023'; end if;

  select p.* into v_plan from public.plans p where p.id=p_plan_id;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id=v_plan.id and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.membership_state='active'::public.plan_membership_state;

  select c.id into v_conversation_id from public.conversations c where c.plan_id=v_plan.id;

  select a.name,c.name,s.code
  into v_activity_name,v_city_name,v_state_code
  from public.activities a
  join public.cities c on c.id=v_plan.city_id
  join public.states s on s.id=c.state_id
  where a.id=v_plan.activity_id;

  select v.name,
         concat_ws(', ',nullif(v.address_line1,''),nullif(v.address_line2,''),v.postal_code),
         v.latitude,v.longitude
  into v_venue_name,v_venue_address,v_venue_latitude,v_venue_longitude
  from public.venues v
  where v.id=v_plan.current_venue_id;

  select nullif(btrim(svo.payload->>'photoUrl'),'')
  into v_venue_photo_url
  from public.signal_venue_rounds svr
  join public.signal_venue_options svo on svo.id=svr.winner_option_id
  where svr.signal_group_id=v_plan.originating_signal_group_id
    and svr.state='won'
  order by svr.round_number desc
  limit 1;
  select jsonb_build_object(
    'requestId',pjr.id,
    'requesterUserId',pjr.requester_user_id,
    'requesterName',coalesce(up.display_name,'SIGNAL member'),
    'state',pjr.state,
    'requestedAt',pjr.requested_at,
    'expiresAt',pjr.expires_at,
    'yesVotes',(select count(*) from public.plan_join_request_votes v where v.request_id=pjr.id and v.vote='yes'),
    'noVotes',(select count(*) from public.plan_join_request_votes v where v.request_id=pjr.id and v.vote='no'),
    'majorityRequired',floor(v_active_count/2.0)::integer+1,
    'myVote',(select v.vote from public.plan_join_request_votes v where v.request_id=pjr.id and v.user_id=v_user_id)
  ) into v_join
  from public.plan_join_requests pjr
  join public.user_profiles up on up.user_id=pjr.requester_user_id
  where pjr.plan_id=v_plan.id and pjr.state='pending'
  order by pjr.requested_at,pjr.id
  limit 1;

  select jsonb_build_object(
    'proposalId',pcp.id,
    'proposerUserId',pcp.proposer_user_id,
    'proposerName',coalesce(up.display_name,'SIGNAL member'),
    'changeType',pcp.change_type,
    'proposedVenueId',pcp.proposed_venue_id,
    'proposedVenueName',v.name,
    'proposedStartsAt',pcp.proposed_starts_at,
    'state',pcp.state,
    'proposedAt',pcp.proposed_at,
    'expiresAt',pcp.expires_at,
    'yesVotes',(select count(*) from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.vote='yes'),
    'noVotes',(select count(*) from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.vote='no'),
    'majorityRequired',floor(v_active_count/2.0)::integer+1,
    'myVote',(select cv.vote from public.plan_change_votes cv where cv.proposal_id=pcp.id and cv.user_id=v_user_id)
  ) into v_change
  from public.plan_change_proposals pcp
  join public.user_profiles up on up.user_id=pcp.proposer_user_id
  left join public.venues v on v.id=pcp.proposed_venue_id
  where pcp.plan_id=v_plan.id and pcp.state='pending'
  order by pcp.proposed_at,pcp.id
  limit 1;

  return jsonb_build_object(
    'planId',v_plan.id,
    'state',v_plan.state,
    'title',v_plan.title,
    'activityName',v_activity_name,
    'cityName',v_city_name,
    'stateCode',v_state_code,
    'capacity',v_plan.capacity,
    'activeMemberCount',v_active_count,
    'admissionMode',v_plan.admission_mode,
    'scheduledStartsAt',v_plan.scheduled_starts_at,
    'scheduledEndsAt',v_plan.scheduled_ends_at,
    'currentVenueId',v_plan.current_venue_id,
    'currentVenueName',v_venue_name,
    'currentVenueAddress',v_venue_address,
    'currentVenueLatitude',v_venue_latitude,
    'currentVenueLongitude',v_venue_longitude,
    'currentVenuePhotoUrl',v_venue_photo_url,
    'conversationId',v_conversation_id,
    'changeFreezeAt',case when v_plan.scheduled_starts_at is null then null else v_plan.scheduled_starts_at-interval '30 minutes' end,
    'joinRequest',v_join,
    'changeProposal',v_change
  );
end;
$function$;

alter function public.get_my_plan_governance(uuid) owner to postgres;
revoke all on function public.get_my_plan_governance(uuid) from public,anon;
grant execute on function public.get_my_plan_governance(uuid) to authenticated;

comment on function public.get_my_plan_governance(uuid)
is 'Returns the caller authoritative Plan experience snapshot, including meetup identity, venue coordinates, time, membership, governance, and active controls.';


commit;
