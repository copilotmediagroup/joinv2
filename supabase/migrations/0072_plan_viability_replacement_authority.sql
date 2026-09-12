begin;

create table if not exists public.plan_replacement_windows (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.plans(id) on delete cascade,
  state text not null check (state in ('open','filled','timed_out','cancelled')),
  required_active_count integer not null check (required_active_count > 0),
  opened_at timestamptz not null,
  deadline_at timestamptz not null,
  filled_at timestamptz,
  timed_out_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists plan_replacement_windows_open_deadline_idx
  on public.plan_replacement_windows(deadline_at)
  where state='open';

create or replace function public.reconcile_plan_replacement_window(p_plan_id uuid)
returns table(status text, active_count integer, required_count integer, deadline_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_now timestamptz:=clock_timestamp();
  v_plan public.plans%rowtype;
  v_required integer;
  v_active integer;
  v_window public.plan_replacement_windows%rowtype;
  v_conversation_id uuid;
begin
  select p.* into v_plan from public.plans p where p.id=p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  select gp.activation_threshold into v_required
  from public.signal_groups sg join public.grouping_policies gp on gp.id=sg.grouping_policy_id
  where sg.id=v_plan.originating_signal_group_id;
  v_required:=coalesce(v_required,1);
  select count(*)::integer into v_active from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.membership_state='active'::public.plan_membership_state;
  select prw.* into v_window from public.plan_replacement_windows prw where prw.plan_id=v_plan.id for update;

  if v_plan.state in ('cancelled'::public.plan_state,'completed'::public.plan_state) then
    if v_window.id is not null and v_window.state='open' then
      update public.plan_replacement_windows set state='cancelled',updated_at=v_now where id=v_window.id;
    end if;
    return query select 'closed'::text,v_active,v_required,v_window.deadline_at; return;
  end if;

  if v_active >= v_required then
    if v_window.id is not null and v_window.state='open' then
      update public.plan_replacement_windows set state='filled',filled_at=v_now,updated_at=v_now where id=v_window.id;
      if v_plan.state='recovery_required'::public.plan_state then
        update public.plans set state='locked'::public.plan_state,updated_at=v_now where id=v_plan.id;
        insert into public.plan_history(plan_id,event_type,actor_user_id,reason,metadata,occurred_at)
        values(v_plan.id,'recovery_resolved',null,'Replacement restored minimum viable group',jsonb_build_object('active_count',v_active,'required_count',v_required),v_now);
      end if;
    end if;
    return query select 'filled'::text,v_active,v_required,v_window.deadline_at; return;
  end if;

  if v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes'
     or (v_window.id is not null and v_window.state='open' and v_window.deadline_at <= v_now) then
    update public.plans set state='cancelled'::public.plan_state,cancelled_at=coalesce(cancelled_at,v_now),updated_at=v_now where id=v_plan.id;
    update public.plan_memberships
      set membership_state='withdrawn'::public.plan_membership_state,withdrawn_at=coalesce(withdrawn_at,v_now),locked_member=false,updated_at=v_now
      where plan_id=v_plan.id and membership_state='active'::public.plan_membership_state;
    select c.id into v_conversation_id from public.conversations c where c.plan_id=v_plan.id;
    if v_conversation_id is not null then
      update public.conversation_membership_intervals set ended_at=coalesce(ended_at,v_now)
      where conversation_id=v_conversation_id and ended_at is null;
    end if;
    if v_window.id is not null then
      update public.plan_replacement_windows set state='timed_out',timed_out_at=v_now,updated_at=v_now where id=v_window.id;
    end if;
    if not exists(select 1 from public.plan_history ph where ph.plan_id=v_plan.id and ph.event_type='cancelled'::public.plan_history_event_type and ph.metadata->>'reason'='replacement_timeout') then
      insert into public.plan_history(plan_id,event_type,actor_user_id,reason,metadata,occurred_at)
      values(v_plan.id,'cancelled',null,'This Signal did not come together in time.',jsonb_build_object('reason','replacement_timeout','active_count',v_active,'required_count',v_required),v_now);
    end if;
    return query select 'cancelled'::text,v_active,v_required,coalesce(v_window.deadline_at,v_now); return;
  end if;

  if v_window.id is null or v_window.state<>'open' then
    insert into public.plan_replacement_windows(plan_id,state,required_active_count,opened_at,deadline_at)
    values(v_plan.id,'open',v_required,v_now,v_now+interval '5 minutes')
    on conflict(plan_id) do update
      set state='open',required_active_count=excluded.required_active_count,opened_at=excluded.opened_at,deadline_at=excluded.deadline_at,
          filled_at=null,timed_out_at=null,updated_at=v_now
    returning * into v_window;
    insert into public.plan_history(plan_id,event_type,actor_user_id,reason,metadata,occurred_at)
    values(v_plan.id,'recovery_required',null,'Plan fell below minimum viable group size; replacement search opened',jsonb_build_object('active_count',v_active,'required_count',v_required,'deadline_at',v_window.deadline_at),v_now);
  end if;
  update public.plans set state='recovery_required'::public.plan_state,updated_at=v_now where id=v_plan.id;
  return query select 'replacing'::text,v_active,v_required,v_window.deadline_at;
end;
$function$;

revoke all on function public.reconcile_plan_replacement_window(uuid) from public,anon,authenticated;

create or replace function public.reconcile_expired_plan_replacements()
returns integer language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_count integer:=0; v record;
begin
  for v in select plan_id from public.plan_replacement_windows where state='open' and deadline_at<=clock_timestamp() loop
    perform public.reconcile_plan_replacement_window(v.plan_id); v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function public.reconcile_expired_plan_replacements() from public,anon,authenticated;

create or replace function public.leave_my_plan(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_plan public.plans%rowtype; v_membership_id uuid; v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select p.* into v_plan from public.plans p where p.id=p_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
  if v_plan.state in ('completed'::public.plan_state,'cancelled'::public.plan_state) then raise exception 'plan_departure_not_allowed' using errcode='P0001'; end if;
  select pm.id into v_membership_id from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.user_id=v_user_id and pm.membership_state='active'::public.plan_membership_state for update;
  if v_membership_id is null then raise exception 'active_plan_membership_not_found' using errcode='P0001'; end if;
  update public.plan_memberships set membership_state='withdrawn',withdrawn_at=v_now,locked_member=false,updated_at=v_now where id=v_membership_id;
  select c.id into v_conversation_id from public.conversations c where c.plan_id=v_plan.id;
  if v_conversation_id is not null then
    update public.conversation_membership_intervals set ended_at=v_now where conversation_id=v_conversation_id and user_id=v_user_id and ended_at is null;
  end if;
  insert into public.plan_history(plan_id,event_type,actor_user_id,reason,metadata,occurred_at)
  values(v_plan.id,'member_withdrew',v_user_id,'Member left Plan',jsonb_build_object('source','leave_my_plan'),v_now);
  perform public.reconcile_plan_replacement_window(v_plan.id);
  return true;
end;
$function$;
revoke all on function public.leave_my_plan(uuid) from public,anon;
grant execute on function public.leave_my_plan(uuid) to authenticated;

create or replace function public.claim_matching_plan_replacement(
  p_city_slug text,p_activity_slug text,p_time_window text,p_crowd_mode public.crowd_mode,p_min_age integer,p_max_age integer
)
returns table(plan_id uuid,claimed boolean)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_plan_id uuid; v_required integer; v_conversation_id uuid; v_profile public.user_profiles%rowtype; v_age integer;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select up.* into v_profile from public.user_profiles up where up.user_id=v_user_id;
  if not found or v_profile.completion_state<>'complete' then raise exception 'user_profile_incomplete' using errcode='P0001'; end if;
  v_age:=extract(year from age(current_date,v_profile.birth_date))::integer;
  if p_min_age is not null and v_age<p_min_age then return query select null::uuid,false; return; end if;
  if p_max_age is not null and v_age>p_max_age then return query select null::uuid,false; return; end if;
  if p_crowd_mode='women_only' and v_profile.gender<>'female' then return query select null::uuid,false; return; end if;
  if p_crowd_mode='men_only' and v_profile.gender<>'male' then return query select null::uuid,false; return; end if;
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

create or replace function public.get_my_plan_replacement_status(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid(); v_result jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from public.plan_memberships pm where pm.plan_id=p_plan_id and pm.user_id=v_user_id and pm.membership_state='active'::public.plan_membership_state) then return null; end if;
  select jsonb_build_object('state',prw.state,'deadlineAt',prw.deadline_at,'requiredActiveCount',prw.required_active_count,
    'activeMemberCount',(select count(*) from public.plan_memberships pm where pm.plan_id=p_plan_id and pm.membership_state='active'::public.plan_membership_state))
  into v_result from public.plan_replacement_windows prw where prw.plan_id=p_plan_id;
  return v_result;
end;
$function$;
revoke all on function public.get_my_plan_replacement_status(uuid) from public,anon;
grant execute on function public.get_my_plan_replacement_status(uuid) to authenticated;

commit;
