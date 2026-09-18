begin;

-- Relationship state is pair-level, but a decline is only terminal for the
-- Signal that produced that request. A later shared attended Signal must be
-- presented as a fresh opportunity to connect.
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
    case
      when sc.id is null then 'none'
      when sc.state='accepted' then 'connected'
      when sc.state='declined' and sc.origin_plan_id=p_plan_id then 'declined'
      when sc.state='declined' then 'none'
      else 'pending'
    end,
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
comment on function public.get_my_completed_plan_connections(uuid)
is 'Post-Signal connection candidates. Declined is exposed only for the Signal where that decline occurred; later shared attended Signals expose a fresh none state.';
commit;
