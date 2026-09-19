begin;

-- A decline ends that request, not the relationship forever. A later shared
-- attended Signal is a new real-world context and may create a fresh request.
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

  -- Serialize the unordered user pair before the first-row lookup. Row locking
  -- alone cannot protect the absent-row case, where opposite-side requests can
  -- otherwise race into the unique(user_low_id,user_high_id) constraint.
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|','signal_connection_pair_v1',v_low::text,v_high::text),0)
  );

  select * into v_connection from public.signal_connections where user_low_id=v_low and user_high_id=v_high for update;
  if not found then
    insert into public.signal_connections(user_low_id,user_high_id,requested_by,origin_plan_id,state,created_at,updated_at)
    values(v_low,v_high,v_user_id,p_plan_id,'pending',v_now,v_now) returning * into v_connection;
  elsif v_connection.state='pending' and v_connection.requested_by<>v_user_id then
    update public.signal_connections set state='accepted',responded_at=v_now,updated_at=v_now where id=v_connection.id returning * into v_connection; v_auto_accepted:=true;
  elsif v_connection.state='declined' then
    if v_connection.origin_plan_id=p_plan_id then
      raise exception 'connection_declined_for_signal' using errcode='P0001';
    end if;
    update public.signal_connections
      set requested_by=v_user_id,origin_plan_id=p_plan_id,state='pending',responded_at=null,updated_at=v_now
      where id=v_connection.id returning * into v_connection;
  end if;

  if v_connection.state='pending' and v_connection.requested_by=v_user_id then
    insert into public.notifications(user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at)
    values(p_target_user_id,'connection_request','STAY CONNECTED?',coalesce((select display_name from public.user_profiles where user_id=v_user_id),'Someone')||' from your SIGNAL wants to stay connected.',p_plan_id,v_connection.id,'connection-request:'||v_connection.id::text||':'||p_plan_id::text||':'||p_target_user_id::text,v_now)
    on conflict(user_id,dedupe_key) do nothing;
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
comment on function public.request_signal_connection(uuid,uuid)
is 'Creates post-Signal connection requests after shared attendance. A decline is terminal for that originating Signal but a later shared attended Signal may create a new request.';
commit;
