begin;

create or replace function public.claim_matching_plan_replacement(
  p_city_slug text,p_activity_slug text,p_time_window text,p_crowd_mode public.crowd_mode,p_min_age integer,p_max_age integer
)
returns table(plan_id uuid,claimed boolean)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_plan_id uuid; v_existing_plan_id uuid; v_required integer; v_conversation_id uuid; v_profile public.user_profiles%rowtype; v_age integer;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select up.* into v_profile from public.user_profiles up where up.user_id=v_user_id;
  if not found or v_profile.completion_state<>'complete' then raise exception 'user_profile_incomplete' using errcode='P0001'; end if;
  v_age:=extract(year from age(current_date,v_profile.birth_date))::integer;
  if p_min_age is not null and v_age<p_min_age then return query select null::uuid,false; return; end if;
  if p_max_age is not null and v_age>p_max_age then return query select null::uuid,false; return; end if;
  if p_crowd_mode='women_only' and v_profile.gender<>'female' then return query select null::uuid,false; return; end if;
  if p_crowd_mode='men_only' and v_profile.gender<>'male' then return query select null::uuid,false; return; end if;

  -- Retry recovery: if the first claim committed but its HTTP response was lost,
  -- return the same matching replacement admission instead of reporting no seat.
  select p.id into v_existing_plan_id
  from public.plan_memberships pm
  join public.plans p on p.id=pm.plan_id
  join public.signal_groups sg on sg.id=p.originating_signal_group_id
  join public.cities c on c.id=p.city_id
  join public.activities a on a.id=p.activity_id
  where pm.user_id=v_user_id
    and pm.membership_state='active'::public.plan_membership_state
    and pm.admission_origin='post_lock_admission'::public.admission_origin
    and p.state not in ('cancelled','completed')
    and c.slug=lower(btrim(p_city_slug))
    and a.slug=lower(btrim(p_activity_slug))
    and sg.time_window_code=upper(btrim(p_time_window))
    and sg.crowd_mode=p_crowd_mode
    and sg.min_age is not distinct from p_min_age
    and sg.max_age is not distinct from p_max_age
  order by pm.joined_at desc,pm.plan_id
  limit 1;

  if v_existing_plan_id is not null then
    return query select v_existing_plan_id,true;
    return;
  end if;
  if exists(select 1 from public.plan_memberships pm join public.plans p on p.id=pm.plan_id where pm.user_id=v_user_id and pm.membership_state='active'::public.plan_membership_state and p.state not in ('cancelled','completed')) then return query select null::uuid,false; return; end if;
  if exists(select 1 from public.signal_intents si where si.user_id=v_user_id and si.state='assigned'::public.signal_intent_state) then return query select null::uuid,false; return; end if;

  select p.id,gp.activation_threshold into v_plan_id,v_required
  from public.plan_replacement_windows prw
  join public.plans p on p.id=prw.plan_id
  join public.signal_groups sg on sg.id=p.originating_signal_group_id
  join public.grouping_policies gp on gp.id=sg.grouping_policy_id
  join public.cities c on c.id=p.city_id
  join public.activities a on a.id=p.activity_id
  where prw.state='open' and prw.deadline_at>v_now and p.state='recovery_required'::public.plan_state
    and p.scheduled_starts_at>v_now+interval '30 minutes'
    and c.slug=lower(btrim(p_city_slug)) and a.slug=lower(btrim(p_activity_slug))
    and sg.time_window_code=upper(btrim(p_time_window)) and sg.crowd_mode=p_crowd_mode
    and sg.min_age is not distinct from p_min_age and sg.max_age is not distinct from p_max_age
    and not exists(select 1 from public.plan_memberships old where old.plan_id=p.id and old.user_id=v_user_id)
  order by prw.opened_at,prw.id limit 1 for update of prw skip locked;

  if v_plan_id is null then return query select null::uuid,false; return; end if;
  insert into public.plan_memberships(plan_id,user_id,membership_state,admission_origin,joined_at,locked_member,created_at,updated_at)
  values(v_plan_id,v_user_id,'active','post_lock_admission',v_now,true,v_now,v_now);
  select c.id into v_conversation_id from public.conversations c where c.plan_id=v_plan_id;
  if v_conversation_id is not null then
    insert into public.conversation_membership_intervals(conversation_id,user_id,started_at,created_at)
    values(v_conversation_id,v_user_id,v_now,v_now);
  end if;
  insert into public.plan_history(plan_id,event_type,actor_user_id,reason,metadata,occurred_at)
  values(v_plan_id,'member_admitted',null,'System replacement restored a vacant Signal seat',jsonb_build_object('replacement_user_id',v_user_id),v_now);
  perform public.reconcile_plan_replacement_window(v_plan_id);
  return query select v_plan_id,true;
end;
$function$;
revoke all on function public.claim_matching_plan_replacement(text,text,text,public.crowd_mode,integer,integer) from public,anon;
grant execute on function public.claim_matching_plan_replacement(text,text,text,public.crowd_mode,integer,integer) to authenticated;

comment on function public.claim_matching_plan_replacement(text,text,text,public.crowd_mode,integer,integer)
is 'Atomically claims a matching replacement seat and safely recovers the same claim after a lost response.';

commit;
