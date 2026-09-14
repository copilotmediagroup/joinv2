begin;

create or replace function public.touch_signal_venue_round_from_child()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_round_id uuid:=coalesce(new.round_id,old.round_id);
begin
  update public.signal_venue_rounds
  set updated_at=clock_timestamp()
  where id=v_round_id;
  return coalesce(new,old);
end;
$function$;

alter function public.touch_signal_venue_round_from_child() owner to postgres;
revoke all on function public.touch_signal_venue_round_from_child() from public,anon,authenticated;

create or replace function public.touch_signal_time_round_from_child()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_round_id uuid:=coalesce(new.round_id,old.round_id);
begin
  update public.signal_time_rounds
  set updated_at=clock_timestamp()
  where id=v_round_id;
  return coalesce(new,old);
end;
$function$;

alter function public.touch_signal_time_round_from_child() owner to postgres;
revoke all on function public.touch_signal_time_round_from_child() from public,anon,authenticated;

create or replace function public.touch_plan_governance_parent_from_vote()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  if tg_table_name='plan_join_request_votes' then
    update public.plan_join_requests
    set updated_at=clock_timestamp()
    where id=coalesce(new.request_id,old.request_id);
  elsif tg_table_name='plan_change_votes' then
    update public.plan_change_proposals
    set updated_at=clock_timestamp()
    where id=coalesce(new.proposal_id,old.proposal_id);
  end if;
  return coalesce(new,old);
end;
$function$;

alter function public.touch_plan_governance_parent_from_vote() owner to postgres;
revoke all on function public.touch_plan_governance_parent_from_vote() from public,anon,authenticated;
drop trigger if exists signal_venue_options_touch_round on public.signal_venue_options;
create trigger signal_venue_options_touch_round
after insert or update or delete on public.signal_venue_options
for each row execute function public.touch_signal_venue_round_from_child();

drop trigger if exists signal_venue_votes_touch_round on public.signal_venue_votes;
create trigger signal_venue_votes_touch_round
after insert or update or delete on public.signal_venue_votes
for each row execute function public.touch_signal_venue_round_from_child();

drop trigger if exists signal_time_options_touch_round on public.signal_time_options;
create trigger signal_time_options_touch_round
after insert or update or delete on public.signal_time_options
for each row execute function public.touch_signal_time_round_from_child();

drop trigger if exists signal_time_availability_touch_round on public.signal_time_availability;
create trigger signal_time_availability_touch_round
after insert or update or delete on public.signal_time_availability
for each row execute function public.touch_signal_time_round_from_child();

drop trigger if exists plan_join_votes_touch_request on public.plan_join_request_votes;
create trigger plan_join_votes_touch_request
after insert or update or delete on public.plan_join_request_votes
for each row execute function public.touch_plan_governance_parent_from_vote();

drop trigger if exists plan_change_votes_touch_proposal on public.plan_change_votes;
create trigger plan_change_votes_touch_proposal
after insert or update or delete on public.plan_change_votes
for each row execute function public.touch_plan_governance_parent_from_vote();

commit;
