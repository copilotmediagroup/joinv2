begin;

-- Data-free invalidation for Live Signal state. Clients receive no attendance
-- or completion data over Realtime; they refetch their authorized RPC snapshot.
create or replace function public.broadcast_live_plan_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_plan_id uuid; v_topic text;
begin
  if tg_table_name='plans' then v_plan_id:=coalesce(new.id,old.id);
  else v_plan_id:=coalesce(new.plan_id,old.plan_id); end if;
  if v_plan_id is null then return coalesce(new,old); end if;
  v_topic:='plan-live:'||v_plan_id::text;
  perform realtime.send(jsonb_build_object('source',tg_table_name),'refresh',v_topic,false);
  return coalesce(new,old);
end;
$function$;
alter function public.broadcast_live_plan_refresh() owner to postgres;
revoke all on function public.broadcast_live_plan_refresh() from public,anon,authenticated;

drop trigger if exists attendance_live_plan_refresh on public.attendance_records;
create trigger attendance_live_plan_refresh after insert or update or delete on public.attendance_records for each row execute function public.broadcast_live_plan_refresh();
drop trigger if exists completion_live_plan_refresh on public.plan_member_outing_completions;
create trigger completion_live_plan_refresh after insert or update or delete on public.plan_member_outing_completions for each row execute function public.broadcast_live_plan_refresh();
drop trigger if exists plan_state_live_plan_refresh on public.plans;
create trigger plan_state_live_plan_refresh after update of state,scheduled_starts_at,scheduled_ends_at,current_venue_id on public.plans for each row execute function public.broadcast_live_plan_refresh();

commit;
