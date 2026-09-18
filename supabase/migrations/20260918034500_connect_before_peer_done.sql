begin;

-- A member may request a post-Signal connection immediately after they press
-- DONE HERE. The recipient does not have to end their own live outing first.
create or replace function public.get_my_completed_plan_connections(p_plan_id uuid)
returns table(connection_id uuid,other_user_id uuid,display_name text,avatar_path text,connection_state text,request_direction text)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.plans p
    join public.plan_memberships mine on mine.plan_id=p.id and mine.user_id=v_user_id
    join public.plan_member_outing_completions done on done.plan_id=p.id and done.user_id=v_user_id
    where p.id=p_plan_id and p.origin='signal'::public.plan_origin
      and mine.membership_state in ('active'::public.plan_membership_state,'completed'::public.plan_membership_state)
      and exists(select 1 from public.attendance_records ar where ar.plan_id=p.id and ar.user_id=v_user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type)
  ) then raise exception 'completed_signal_outing_required' using errcode='42501'; end if;

  return query
  select sc.id,pm.user_id,coalesce(up.display_name,'SIGNAL member'),up.avatar_path,
    case when sc.id is null then 'none' when sc.state='accepted' then 'connected' when sc.state='declined' then 'declined' else 'pending' end,
    case when sc.id is null or sc.state<>'pending' then 'none' when sc.requested_by=v_user_id then 'outgoing' else 'incoming' end
  from public.plan_memberships pm
  join public.user_profiles up on up.user_id=pm.user_id
  left join public.signal_connections sc on sc.user_low_id=least(v_user_id,pm.user_id) and sc.user_high_id=greatest(v_user_id,pm.user_id)
  where pm.plan_id=p_plan_id and pm.user_id<>v_user_id
    and pm.membership_state in ('active'::public.plan_membership_state,'completed'::public.plan_membership_state)
    and exists(select 1 from public.attendance_records ar where ar.plan_id=p_plan_id and ar.user_id=pm.user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type)
    and not public.users_have_block_relation(v_user_id,pm.user_id)
  order by pm.joined_at,pm.id;
end;$function$;

alter function public.get_my_completed_plan_connections(uuid) owner to postgres;
revoke all on function public.get_my_completed_plan_connections(uuid) from public,anon;
grant execute on function public.get_my_completed_plan_connections(uuid) to authenticated;

create or replace function public.request_signal_connection(p_plan_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_low uuid; v_high uuid; v_connection public.signal_connections%rowtype; v_now timestamptz:=clock_timestamp(); v_auto_accepted boolean:=false;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then raise exception 'invalid_connection_target' using errcode='22023'; end if;
  if public.users_have_block_relation(v_user_id,p_target_user_id) then raise exception 'connection_blocked' using errcode='42501'; end if;
  if not exists(
    select 1 from public.plans p
    join public.plan_memberships mine on mine.plan_id=p.id and mine.user_id=v_user_id
    join public.plan_memberships theirs on theirs.plan_id=p.id and theirs.user_id=p_target_user_id
    join public.plan_member_outing_completions mine_done on mine_done.plan_id=p.id and mine_done.user_id=v_user_id
    where p.id=p_plan_id and p.origin='signal'::public.plan_origin
      and mine.membership_state in ('active'::public.plan_membership_state,'completed'::public.plan_membership_state)
      and theirs.membership_state in ('active'::public.plan_membership_state,'completed'::public.plan_membership_state)
      and exists(select 1 from public.attendance_records ar where ar.plan_id=p.id and ar.user_id=v_user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type)
      and exists(select 1 from public.attendance_records ar where ar.plan_id=p.id and ar.user_id=p_target_user_id and ar.evidence_type='self_reported'::public.attendance_evidence_type)
  ) then raise exception 'shared_signal_attendance_required' using errcode='42501'; end if;

  v_low:=least(v_user_id,p_target_user_id); v_high:=greatest(v_user_id,p_target_user_id);
  select * into v_connection from public.signal_connections where user_low_id=v_low and user_high_id=v_high for update;
  if not found then
    insert into public.signal_connections(user_low_id,user_high_id,requested_by,origin_plan_id,state,created_at,updated_at)
    values(v_low,v_high,v_user_id,p_plan_id,'pending',v_now,v_now) returning * into v_connection;
    insert into public.notifications(user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at)
    values(p_target_user_id,'connection_request','STAY CONNECTED?',coalesce((select display_name from public.user_profiles where user_id=v_user_id),'Someone')||' from your SIGNAL wants to stay connected.',p_plan_id,v_connection.id,'connection-request:'||v_connection.id::text||':'||p_target_user_id::text,v_now)
    on conflict(user_id,dedupe_key) do nothing;
  elsif v_connection.state='pending' and v_connection.requested_by<>v_user_id then
    update public.signal_connections set state='accepted',responded_at=v_now,updated_at=v_now where id=v_connection.id returning * into v_connection; v_auto_accepted:=true;
  elsif v_connection.state='declined' then raise exception 'connection_declined' using errcode='P0001';
  end if;
  if v_connection.state='accepted' then
    insert into public.notifications(user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at)
    select u,'connection_accepted','YOU’RE CONNECTED',coalesce((select display_name from public.user_profiles where user_id=case when u=v_user_id then p_target_user_id else v_user_id end),'Your SIGNAL connection')||' connected with you.',p_plan_id,v_connection.id,'connection-accepted:'||v_connection.id::text||':'||u::text,v_now
    from (values(v_user_id),(p_target_user_id)) x(u) on conflict(user_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('connectionId',v_connection.id,'state',case when v_connection.state='accepted' then 'connected' else v_connection.state::text end,'autoAccepted',v_auto_accepted);
end;$function$;

alter function public.request_signal_connection(uuid,uuid) owner to postgres;
revoke all on function public.request_signal_connection(uuid,uuid) from public,anon;
grant execute on function public.request_signal_connection(uuid,uuid) to authenticated;
commit;
