begin;

-- Migration 0035: repair PL/pgSQL output-column ambiguity in join voting.
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
  v_active_count integer;
  v_majority integer;
  v_state text;
  v_yes integer;
  v_no integer;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_vote not in ('yes','no') then raise exception 'invalid_join_vote' using errcode = '22023'; end if;

  select pjr.* into v_request
  from public.plan_join_requests pjr
  where pjr.id = p_request_id
  for update;

  if not found then raise exception 'plan_join_request_not_found' using errcode = 'P0001'; end if;
  if v_request.state <> 'pending' then raise exception 'plan_join_request_not_pending' using errcode = 'P0001'; end if;

  if not exists (
    select 1 from public.plan_memberships pm
    where pm.plan_id = v_request.plan_id
      and pm.user_id = v_user_id
      and pm.membership_state = 'active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode = '42501';
  end if;

  if v_request.expires_at <= v_now then
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
    and pm.membership_state = 'active'::public.plan_membership_state;
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
revoke all on function public.vote_on_plan_join_request(uuid,text) from public, anon;
grant execute on function public.vote_on_plan_join_request(uuid,text) to authenticated;

commit;
