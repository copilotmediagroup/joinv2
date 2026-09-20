begin;

create or replace function public.finalize_chill_time_choice(p_signal_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_group public.signal_groups%rowtype;
  v_activity_slug text;
  v_round public.signal_time_rounds%rowtype;
  v_winner uuid;
  v_confirmed integer;
begin
  if p_signal_group_id is null then raise exception 'signal_group_id_required' using errcode='22023'; end if;
  select sg.* into v_group from public.signal_groups sg where sg.id=p_signal_group_id for update;
  if not found then raise exception 'signal_group_not_found' using errcode='P0001'; end if;
  select a.slug into v_activity_slug from public.activities a where a.id=v_group.activity_id;
  if v_activity_slug<>'chill' then return null; end if;
  if v_group.state not in ('locked','coordinating') then raise exception 'chill_signal_not_ready_for_time_choice' using errcode='P0001'; end if;
  if not exists(select 1 from public.signal_venue_rounds svr where svr.signal_group_id=v_group.id and svr.state='won' and svr.winner_option_id is not null) then raise exception 'signal_venue_winner_required' using errcode='P0001'; end if;

  select count(*)::integer into v_confirmed from public.signal_group_memberships sgm
  where sgm.signal_group_id=v_group.id and sgm.state='confirmed' and sgm.is_active_core=true;
  if v_confirmed<>2 then raise exception 'chill_pair_not_confirmed: %',v_confirmed using errcode='P0001'; end if;

  select * into v_round from public.signal_time_rounds str where str.signal_group_id=v_group.id for update;
  if not found then raise exception 'signal_time_round_not_found' using errcode='P0001'; end if;
  if v_round.state='won' and v_round.winner_option_id is not null then return v_round.winner_option_id; end if;
  if v_round.state<>'open' then raise exception 'chill_time_round_not_open: %',v_round.state using errcode='P0001'; end if;

  select sto.id into v_winner from public.signal_time_options sto
  where sto.round_id=v_round.id and sto.starts_at>=clock_timestamp()
  order by case when upper(coalesce(sto.label,''))='BEST FIT' then 0 else 1 end,sto.source_rank asc,sto.starts_at asc,sto.id asc limit 1;
  if v_winner is null then raise exception 'chill_future_time_option_required' using errcode='P0001'; end if;

  update public.signal_time_rounds set state='won',winner_option_id=v_winner,updated_at=clock_timestamp()
  where id=v_round.id and state='open';
  return v_winner;
end;
$function$;

alter function public.finalize_chill_time_choice(uuid) owner to postgres;
revoke all on function public.finalize_chill_time_choice(uuid) from public,anon,authenticated;
grant execute on function public.finalize_chill_time_choice(uuid) to service_role;
comment on function public.finalize_chill_time_choice(uuid) is 'Server-only deterministic Chill time finalizer. Requires the confirmed reciprocal pair and won venue, preferring the generated BEST FIT future option.';

commit;
