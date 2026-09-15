begin;

-- Venue authority: when the fast vote window closes, a plurality wins.
-- One vote beats silence. If nobody votes, SIGNAL chooses its highest-ranked
-- recommendation. Equal vote totals are resolved deterministically by SIGNAL rank.
create or replace function public.reconcile_signal_venue_round(p_round_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_group_id uuid; v_group public.signal_groups%rowtype; v_round public.signal_venue_rounds%rowtype;
  v_eligible_count integer; v_majority integer; v_top_option_id uuid; v_top_votes integer:=0;
begin
  select signal_group_id into v_group_id from public.signal_venue_rounds where id=p_round_id;
  if v_group_id is null then raise exception 'signal_venue_round_not_found' using errcode='P0001'; end if;
  select * into v_group from public.signal_groups where id=v_group_id for update;
  select * into v_round from public.signal_venue_rounds where id=p_round_id for update;
  if not found then raise exception 'signal_venue_round_not_found' using errcode='P0001'; end if;
  if v_round.state<>'open' then return; end if;
  select count(*)::integer into v_eligible_count from public.signal_group_memberships
   where signal_group_id=v_group.id and state='confirmed'::public.signal_group_membership_state and is_active_core=true;
  if v_eligible_count<1 then update public.signal_venue_rounds set state='deadlocked',updated_at=clock_timestamp() where id=v_round.id; return; end if;
  v_majority:=floor(v_eligible_count/2.0)::integer+1;
  update public.signal_venue_rounds set eligible_voter_count=v_eligible_count,majority_required=v_majority,updated_at=clock_timestamp() where id=v_round.id;
  select svo.id,count(svv.user_id)::integer into v_top_option_id,v_top_votes
  from public.signal_venue_options svo left join public.signal_venue_votes svv on svv.round_id=svo.round_id and svv.option_id=svo.id
   and exists(select 1 from public.signal_group_memberships sgm where sgm.signal_group_id=v_group.id and sgm.user_id=svv.user_id and sgm.state='confirmed'::public.signal_group_membership_state and sgm.is_active_core=true)
  where svo.round_id=v_round.id group by svo.id,svo.source_rank order by count(svv.user_id) desc,svo.source_rank asc,svo.id asc limit 1;
  if v_top_option_id is not null and (v_top_votes>=v_majority or clock_timestamp()>=v_round.closes_at) then
    update public.signal_venue_rounds set state='won',winner_option_id=v_top_option_id,updated_at=clock_timestamp() where id=v_round.id and state='open'; return;
  end if;
end;$function$;

alter function public.reconcile_signal_venue_round(uuid) owner to postgres;
revoke all on function public.reconcile_signal_venue_round(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_signal_venue_round(uuid) to service_role;

-- Time authority: honor submitted availability first. At timeout, non-response
-- is neutral rather than a veto; choose the strongest available/preferred option.
-- With zero responses, choose SIGNAL's earliest practical offered time.
create or replace function public.reconcile_signal_time_round(p_round_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_group_id uuid; v_group public.signal_groups%rowtype; v_policy public.grouping_policies%rowtype; v_round public.signal_time_rounds%rowtype;
  v_eligible_count integer; v_responded_count integer; v_winner_option_id uuid; v_winner_available_count integer:=0;
begin
  select signal_group_id into v_group_id from public.signal_time_rounds where id=p_round_id;
  if v_group_id is null then raise exception 'signal_time_round_not_found' using errcode='P0001'; end if;
  select * into v_group from public.signal_groups where id=v_group_id for update;
  select * into v_round from public.signal_time_rounds where id=p_round_id for update;
  if not found then raise exception 'signal_time_round_not_found' using errcode='P0001'; end if;
  if v_round.state<>'open' then return; end if;
  select * into v_policy from public.grouping_policies where id=v_group.grouping_policy_id;
  if not found or v_policy.activation_threshold is null then raise exception 'invalid_signal_activation_threshold' using errcode='P0001'; end if;
  select count(*)::integer into v_eligible_count from public.signal_group_memberships where signal_group_id=v_group.id and state='confirmed'::public.signal_group_membership_state and is_active_core=true;
  update public.signal_time_rounds set eligible_participant_count=v_eligible_count,activation_threshold=v_policy.activation_threshold,updated_at=clock_timestamp() where id=v_round.id;
  if v_eligible_count<v_policy.activation_threshold then update public.signal_time_rounds set state='no_eligible',winner_option_id=null,updated_at=clock_timestamp() where id=v_round.id and state='open'; return; end if;
  select count(distinct user_id)::integer into v_responded_count from public.signal_time_availability sta where sta.round_id=v_round.id
   and exists(select 1 from public.signal_group_memberships sgm where sgm.signal_group_id=v_group.id and sgm.user_id=sta.user_id and sgm.state='confirmed'::public.signal_group_membership_state and sgm.is_active_core=true);
  select sto.id,count(*) filter(where sta.available=true)::integer into v_winner_option_id,v_winner_available_count
  from public.signal_time_options sto left join public.signal_time_availability sta on sta.round_id=sto.round_id and sta.option_id=sto.id
  where sto.round_id=v_round.id group by sto.id,sto.starts_at
  order by count(*) filter(where sta.available=true) desc,count(*) filter(where sta.available=true and sta.is_preferred=true) desc,sto.starts_at asc,sto.id asc limit 1;
  if v_winner_option_id is not null and v_winner_available_count>=v_policy.activation_threshold then update public.signal_time_rounds set state='won',winner_option_id=v_winner_option_id,updated_at=clock_timestamp() where id=v_round.id and state='open'; return; end if;
  if clock_timestamp()<v_round.closes_at then return; end if;
  if v_winner_option_id is not null and (v_winner_available_count>0 or v_responded_count=0) then update public.signal_time_rounds set state='won',winner_option_id=v_winner_option_id,updated_at=clock_timestamp() where id=v_round.id and state='open'; return; end if;
  update public.signal_time_rounds set state='no_eligible',winner_option_id=null,updated_at=clock_timestamp() where id=v_round.id and state='open';
end;$function$;

alter function public.reconcile_signal_time_round(uuid) owner to postgres;
revoke all on function public.reconcile_signal_time_round(uuid) from public,anon;
grant execute on function public.reconcile_signal_time_round(uuid) to authenticated;
commit;
