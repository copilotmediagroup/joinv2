begin;
create or replace function public.notify_signal_peer_arrival()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_name text;
begin
  if new.evidence_type <> 'self_reported'::public.attendance_evidence_type then return new; end if;
  select coalesce(nullif(trim(up.display_name),''),'Someone') into v_name from public.user_profiles up where up.user_id=new.user_id;
  insert into public.notifications(user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at)
  select pm.user_id,'signal_member_arrived','SIGNAL ARRIVAL',v_name||' is here at your Signal.',new.plan_id,new.user_id,'signal-arrival:'||new.plan_id::text||':'||new.user_id::text||':'||pm.user_id::text,clock_timestamp()
  from public.plan_memberships pm
  where pm.plan_id=new.plan_id and pm.membership_state='active'::public.plan_membership_state and pm.user_id<>new.user_id
  on conflict (user_id,dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$function$;
alter function public.notify_signal_peer_arrival() owner to postgres;
revoke all on function public.notify_signal_peer_arrival() from public,anon,authenticated;
drop trigger if exists signal_peer_arrival_notification on public.attendance_records;
create trigger signal_peer_arrival_notification after insert on public.attendance_records for each row execute function public.notify_signal_peer_arrival();
commit;
