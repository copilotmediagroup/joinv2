begin;

create or replace function public.reconcile_plan_change_proposal(p_proposal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_proposal public.plan_change_proposals%rowtype;
  v_plan public.plans%rowtype;
  v_plan_id uuid;
  v_active_count integer;
  v_majority integer;
  v_yes integer;
  v_no integer;
  v_duration interval;
  v_previous_venue uuid;
  v_previous_start timestamptz;
begin
  select pcp.plan_id into v_plan_id
  from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id;
  if v_plan_id is null then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;

  -- Canonical governance lock order is Plan -> proposal, matching proposal creation.
  select p.* into v_plan from public.plans p where p.id=v_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;

  select pcp.* into v_proposal
  from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id and pcp.plan_id=v_plan.id
  for update;
  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;
  if v_proposal.state <> 'pending' then return v_proposal.state; end if;

  select count(*)::integer into v_active_count
  from public.plan_memberships pm
  where pm.plan_id=v_plan.id and pm.membership_state='active'::public.plan_membership_state;
  v_majority := floor(v_active_count/2.0)::integer + 1;

  select
    count(*) filter (where pcv.vote='yes')::integer,
    count(*) filter (where pcv.vote='no')::integer
  into v_yes,v_no
  from public.plan_change_votes pcv
  where pcv.proposal_id=v_proposal.id
    and exists (
      select 1 from public.plan_memberships pm
      where pm.plan_id=v_plan.id and pm.user_id=pcv.user_id
        and pm.membership_state='active'::public.plan_membership_state
    );

  if v_plan.state in ('completed'::public.plan_state,'cancelled'::public.plan_state,'active_outing'::public.plan_state)
     or v_plan.scheduled_starts_at is null
     or v_plan.scheduled_starts_at <= v_now + interval '30 minutes' then
    update public.plan_change_proposals
    set state='expired',resolved_at=v_now,resolution_reason='change_window_closed',updated_at=v_now
    where id=v_proposal.id;
    return 'expired';
  end if;

  if v_yes >= v_majority then
    v_previous_venue := v_plan.current_venue_id;
    v_previous_start := v_plan.scheduled_starts_at;

    if v_proposal.change_type='venue' then
      if not exists (select 1 from public.venues v where v.id=v_proposal.proposed_venue_id) then
        raise exception 'proposed_venue_not_found' using errcode='P0001';
      end if;
      update public.plans
      set current_venue_id=v_proposal.proposed_venue_id,updated_at=v_now
      where id=v_plan.id;

      insert into public.plan_history(
        plan_id,event_type,actor_user_id,previous_venue_id,new_venue_id,reason,metadata,occurred_at
      ) values (
        v_plan.id,'venue_changed',v_proposal.proposer_user_id,
        v_previous_venue,v_proposal.proposed_venue_id,'group_vote',
        jsonb_build_object('proposal_id',v_proposal.id,'yes_votes',v_yes,'eligible_members',v_active_count),v_now
      );
    else
      if v_proposal.proposed_starts_at <= v_now + interval '30 minutes' then
        update public.plan_change_proposals
        set state='rejected',resolved_at=v_now,resolution_reason='proposed_time_too_soon',updated_at=v_now
        where id=v_proposal.id;
        return 'rejected';
      end if;

      v_duration := greatest(
        coalesce(v_plan.scheduled_ends_at-v_plan.scheduled_starts_at,interval '2 hours'),
        interval '30 minutes'
      );

      update public.plans
      set scheduled_starts_at=v_proposal.proposed_starts_at,
          scheduled_ends_at=v_proposal.proposed_starts_at+v_duration,
          updated_at=v_now
      where id=v_plan.id;

      insert into public.plan_history(
        plan_id,event_type,actor_user_id,previous_starts_at,new_starts_at,reason,metadata,occurred_at
      ) values (
        v_plan.id,'time_changed',v_proposal.proposer_user_id,
        v_previous_start,v_proposal.proposed_starts_at,'group_vote',
        jsonb_build_object('proposal_id',v_proposal.id,'yes_votes',v_yes,'eligible_members',v_active_count),v_now
      );
    end if;

    update public.plan_change_proposals
    set state='approved',resolved_at=v_now,resolution_reason='group_majority',updated_at=v_now
    where id=v_proposal.id;
    return 'approved';
  end if;

  if v_no >= v_majority or v_proposal.expires_at <= v_now then
    update public.plan_change_proposals
    set state='rejected',resolved_at=v_now,
        resolution_reason=case when v_no>=v_majority then 'group_majority_no' else 'vote_timeout' end,
        updated_at=v_now
    where id=v_proposal.id;
    return 'rejected';
  end if;

  return 'pending';
end;
$function$;


alter function public.reconcile_plan_change_proposal(uuid) owner to postgres;
revoke all on function public.reconcile_plan_change_proposal(uuid) from public,anon,authenticated;

create or replace function public.vote_on_plan_change(p_proposal_id uuid,p_vote text)
returns table(proposal_id uuid,proposal_state text,yes_votes integer,no_votes integer,majority_required integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_proposal public.plan_change_proposals%rowtype;
  v_plan_id uuid;
  v_active integer;
  v_majority integer;
  v_state text;
  v_yes integer;
  v_no integer;
  v_existing_vote text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_plan_change_vote' using errcode='22023'; end if;

  select pcp.plan_id into v_plan_id
  from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id;
  if v_plan_id is null then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;

  perform 1 from public.plans p where p.id=v_plan_id for update;
  if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;

  select pcp.* into v_proposal from public.plan_change_proposals pcp
  where pcp.id=p_proposal_id and pcp.plan_id=v_plan_id for update;
  if not found then raise exception 'plan_change_proposal_not_found' using errcode='P0001'; end if;

  if not public.is_active_plan_member(v_proposal.plan_id) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  if v_proposal.state <> 'pending' then
    select pcv.vote into v_existing_vote
    from public.plan_change_votes pcv
    where pcv.proposal_id=v_proposal.id and pcv.user_id=v_user_id;
    if v_existing_vote is null or v_existing_vote <> p_vote then
      raise exception 'plan_change_proposal_not_pending' using errcode='P0001';
    end if;
    v_state := v_proposal.state;
  elsif v_proposal.expires_at <= v_now then
    v_state := public.reconcile_plan_change_proposal(v_proposal.id);
  else
    insert into public.plan_change_votes(proposal_id,user_id,vote,voted_at,updated_at)
    values(v_proposal.id,v_user_id,p_vote,v_now,v_now)
    on conflict on constraint plan_change_votes_pkey do update
      set vote=excluded.vote,voted_at=v_now,updated_at=v_now;
    v_state := public.reconcile_plan_change_proposal(v_proposal.id);
  end if;

  select count(*)::integer into v_active
  from public.plan_memberships pm
  where pm.plan_id=v_proposal.plan_id and pm.membership_state='active'::public.plan_membership_state;
  v_majority := floor(v_active/2.0)::integer+1;

  select
    count(*) filter(where pcv.vote='yes')::integer,
    count(*) filter(where pcv.vote='no')::integer
  into v_yes,v_no
  from public.plan_change_votes pcv
  where pcv.proposal_id=v_proposal.id;

  return query select v_proposal.id,v_state,v_yes,v_no,v_majority;
end;
$function$;


alter function public.vote_on_plan_change(uuid,text) owner to postgres;
revoke all on function public.vote_on_plan_change(uuid,text) from public,anon;
grant execute on function public.vote_on_plan_change(uuid,text) to authenticated;

comment on function public.reconcile_plan_change_proposal(uuid) is 'Serializes Plan-change decisions in canonical Plan-to-proposal lock order to avoid proposal/vote deadlocks.';
comment on function public.vote_on_plan_change(uuid,text) is 'Retry-safe Plan-change voting using canonical Plan-to-proposal lock order before reconciliation.';

commit;
