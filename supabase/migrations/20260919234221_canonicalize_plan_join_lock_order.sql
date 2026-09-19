begin;

create or replace function public.reconcile_plan_join_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.plan_join_requests%rowtype;
  v_plan public.plans%rowtype;
  v_plan_id uuid;
  v_active_count integer;
  v_majority_required integer;
  v_yes integer;
  v_no integer;
  v_conversation_id uuid;
begin
  -- Canonical governance lock order is Plan -> request. This matches
  -- request_to_join_plan and leave_my_plan and removes request->Plan inversion.
  select pjr.plan_id into v_plan_id
  from public.plan_join_requests pjr
  where pjr.id=p_request_id;
  if v_plan_id is null then
    raise exception 'plan_join_request_not_found' using errcode='P0001';
  end if;

  select p.* into v_plan
  from public.plans p
  where p.id=v_plan_id
  for update;
  if not found then
    raise exception 'plan_not_found' using errcode='P0001';
  end if;

  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id=p_request_id
    and pjr.plan_id=v_plan.id
  for update;
  if not found then
    raise exception 'plan_join_request_not_found' using errcode='P0001';
  end if;

  if v_request.state <> 'pending' then
    return v_request.state;
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_plan.id
    and pm.membership_state = 'active'::public.plan_membership_state;

  v_majority_required := floor(v_active_count / 2.0)::integer + 1;

  select
    count(*) filter (where pjr_vote.vote = 'yes')::integer,
    count(*) filter (where pjr_vote.vote = 'no')::integer
  into v_yes, v_no
  from public.plan_join_request_votes pjr_vote
  where pjr_vote.request_id = v_request.id
    and exists (
      select 1 from public.plan_memberships pm
      where pm.plan_id = v_plan.id
        and pm.user_id = pjr_vote.user_id
        and pm.membership_state = 'active'::public.plan_membership_state
    );

  if v_plan.state in ('completed'::public.plan_state, 'cancelled'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    update public.plan_join_requests
    set state = 'expired', resolved_at = v_now,
        resolution_reason = 'admission_window_closed', updated_at = v_now
    where id = v_request.id;
    perform public.promote_next_plan_join_request(v_plan.id);
    return 'expired';
  end if;

  if v_active_count >= v_plan.capacity then
    update public.plan_join_requests
    set state = 'rejected', resolved_at = v_now,
        resolution_reason = 'capacity_full', updated_at = v_now
    where id = v_request.id;
    perform public.promote_next_plan_join_request(v_plan.id);
    return 'rejected';
  end if;

  if v_yes >= v_majority_required then
    insert into public.plan_memberships (
      plan_id, user_id, membership_state, admission_origin,
      joined_at, locked_member, withdrawn_at, created_at, updated_at
    ) values (
      v_plan.id, v_request.requester_user_id, 'active', 'group_vote',
      v_now, false, null, v_now, v_now
    )
    on conflict (plan_id, user_id) do update
    set membership_state = 'active',
        admission_origin = 'group_vote',
        joined_at = v_now,
        locked_member = false,
        withdrawn_at = null,
        updated_at = v_now;

    select c.id into v_conversation_id
    from public.conversations c
    where c.plan_id = v_plan.id;

    if v_conversation_id is null then
      raise exception 'plan_conversation_not_found' using errcode = 'P0001';
    end if;

    insert into public.conversation_membership_intervals (
      conversation_id, user_id, started_at, created_at
    )
    select v_conversation_id, v_request.requester_user_id, v_now, v_now
    where not exists (
      select 1 from public.conversation_membership_intervals cmi
      where cmi.conversation_id = v_conversation_id
        and cmi.user_id = v_request.requester_user_id
        and cmi.ended_at is null
    );

    update public.plan_join_requests
    set state = 'approved', resolved_at = v_now,
        resolution_reason = 'group_majority', updated_at = v_now
    where id = v_request.id;

    perform public.promote_next_plan_join_request(v_plan.id);
    return 'approved';
  end if;

  if v_no >= v_majority_required
     or (v_request.expires_at is not null and v_request.expires_at <= v_now) then
    update public.plan_join_requests
    set state = 'rejected', resolved_at = v_now,
        resolution_reason = case
          when v_no >= v_majority_required then 'group_majority_no'
          else 'vote_timeout'
        end,
        updated_at = v_now
    where id = v_request.id;

    perform public.promote_next_plan_join_request(v_plan.id);
    return 'rejected';
  end if;

  return 'pending';
end;
$function$;


alter function public.reconcile_plan_join_request(uuid) owner to postgres;
revoke all on function public.reconcile_plan_join_request(uuid) from public,anon,authenticated;

create or replace function public.vote_on_plan_join_request(
  p_request_id uuid,
  p_vote text
)
returns table (
  request_id uuid,
  request_state text,
  yes_votes integer,
  no_votes integer,
  majority_required integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_request public.plan_join_requests%rowtype;
  v_plan_id uuid;
  v_active_count integer;
  v_majority integer;
  v_state text;
  v_yes integer;
  v_no integer;
  v_existing_vote text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_join_vote' using errcode = '22023'; end if;

  select pjr.plan_id into v_plan_id
  from public.plan_join_requests pjr
  where pjr.id=p_request_id;
  if v_plan_id is null then raise exception 'plan_join_request_not_found' using errcode='P0001'; end if;

  -- Plan first, then request: same order as request/leave/reconcile.
  perform 1 from public.plans p where p.id=v_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;

  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id=p_request_id and pjr.plan_id=v_plan_id
  for update;
  if not found then raise exception 'plan_join_request_not_found' using errcode='P0001'; end if;

  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id = v_request.plan_id
      and pm.user_id = v_user_id
      and pm.membership_state = 'active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode = '42501';
  end if;

  if v_request.state <> 'pending' then
    select pjr_vote.vote into v_existing_vote
    from public.plan_join_request_votes pjr_vote
    where pjr_vote.request_id=v_request.id and pjr_vote.user_id=v_user_id;
    if v_existing_vote is null or v_existing_vote <> p_vote then
      raise exception 'plan_join_request_not_pending' using errcode = 'P0001';
    end if;
    v_state := v_request.state;
  elsif v_request.expires_at <= v_now then
    v_state := public.reconcile_plan_join_request(v_request.id);
  else
    insert into public.plan_join_request_votes(request_id,user_id,vote,voted_at,updated_at)
    values (v_request.id,v_user_id,p_vote,v_now,v_now)
    on conflict on constraint plan_join_request_votes_pkey do update
    set vote = excluded.vote, voted_at = v_now, updated_at = v_now;
    v_state := public.reconcile_plan_join_request(v_request.id);
  end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id = v_request.plan_id
    and pm.membership_state = 'active'::public.plan_membership_state
    and pm.user_id <> v_request.requester_user_id;
  v_majority := floor(v_active_count / 2.0)::integer + 1;

  select
    count(*) filter (where vote = 'yes')::integer,
    count(*) filter (where vote = 'no')::integer
  into v_yes,v_no
  from public.plan_join_request_votes pjr_vote
  where pjr_vote.request_id = v_request.id;

  return query select v_request.id, v_state, v_yes, v_no, v_majority;
end;
$function$;


alter function public.vote_on_plan_join_request(uuid,text) owner to postgres;
revoke all on function public.vote_on_plan_join_request(uuid,text) from public,anon;
grant execute on function public.vote_on_plan_join_request(uuid,text) to authenticated;

comment on function public.reconcile_plan_join_request(uuid) is 'Serializes Plan admission decisions in canonical Plan-to-request lock order to avoid vote/leave/request deadlocks.';
comment on function public.vote_on_plan_join_request(uuid,text) is 'Retry-safe join voting using canonical Plan-to-request lock order before decision reconciliation.';

commit;
