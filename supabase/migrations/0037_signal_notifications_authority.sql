begin;

-- ============================================================
-- SIGNAL
-- Migration 0037
-- Authoritative in-app notifications + realtime delivery
-- ============================================================

alter table public.notifications
  add column if not exists dedupe_key text,
  add column if not exists related_entity_id uuid;

create unique index if not exists notifications_user_dedupe_key
  on public.notifications(user_id,dedupe_key);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id,created_at desc,id);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select to authenticated
using (user_id=auth.uid());

revoke all on table public.notifications from anon;
revoke insert,update,delete on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;

create or replace function public.enqueue_signal_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_plan_id uuid default null,
  p_signal_group_id uuid default null,
  p_related_entity_id uuid default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_id uuid;
begin
  if p_user_id is null or nullif(btrim(p_type),'') is null or nullif(btrim(p_title),'') is null then
    raise exception 'notification_identity_required' using errcode='22023';
  end if;

  insert into public.notifications(
    user_id,type,title,body,state,related_plan_id,related_signal_group_id,
    related_decision_id,related_entity_id,created_at,read_at,dedupe_key
  ) values (
    p_user_id,p_type,p_title,p_body,'unread',p_plan_id,p_signal_group_id,
    null,p_related_entity_id,clock_timestamp(),null,p_dedupe_key
  )
  on conflict (user_id,dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

alter function public.enqueue_signal_notification(uuid,text,text,text,uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.enqueue_signal_notification(uuid,text,text,text,uuid,uuid,uuid,text) from public,anon,authenticated;

create or replace function public.mark_my_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  update public.notifications
  set state='read',read_at=coalesce(read_at,clock_timestamp())
  where id=p_notification_id and user_id=v_user_id;
  if not found then raise exception 'notification_not_found' using errcode='P0001'; end if;
  return true;
end;
$function$;

alter function public.mark_my_notification_read(uuid) owner to postgres;
revoke all on function public.mark_my_notification_read(uuid) from public,anon;
grant execute on function public.mark_my_notification_read(uuid) to authenticated;

create or replace function public.notify_signal_group_state_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_member record;
  v_title text;
  v_body text;
  v_type text;
begin
  if old.state is not distinct from new.state then return new; end if;

  if new.state='locked'::public.signal_group_state then
    v_type:='signal_locked'; v_title:='IT’S HAPPENING';
    v_body:='Your Signal reached critical mass. Choose the place and time together.';
  elsif new.state in ('expired'::public.signal_group_state,'cancelled'::public.signal_group_state) then
    v_type:='signal_ended'; v_title:='SIGNAL DIDN’T COME TOGETHER';
    v_body:='This Signal closed before the meetup was set.';
  else
    return new;
  end if;

  for v_member in
    select distinct sgm.user_id
    from public.signal_group_memberships sgm
    where sgm.signal_group_id=new.id
      and sgm.state in ('matched','confirmed')
  loop
    perform public.enqueue_signal_notification(
      v_member.user_id,v_type,v_title,v_body,null,new.id,null,
      v_type||':'||new.id::text
    );
  end loop;
  return new;
end;
$function$;

create or replace function public.notify_signal_one_more()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_group public.signal_groups%rowtype;
  v_threshold integer;
  v_count integer;
  v_member record;
begin
  select sg.* into v_group from public.signal_groups sg where sg.id=new.signal_group_id;
  if not found or v_group.state<>'forming'::public.signal_group_state then return new; end if;
  select gp.activation_threshold into v_threshold from public.grouping_policies gp where gp.id=v_group.grouping_policy_id;
  select count(*)::integer into v_count
  from public.signal_group_memberships sgm
  where sgm.signal_group_id=v_group.id and sgm.state in ('matched','confirmed');

  if v_threshold is not null and v_threshold>1 and v_count=v_threshold-1 then
    for v_member in
      select distinct sgm.user_id from public.signal_group_memberships sgm
      where sgm.signal_group_id=v_group.id and sgm.state in ('matched','confirmed')
    loop
      perform public.enqueue_signal_notification(
        v_member.user_id,'signal_one_more','ONE MORE',
        'One more compatible person and this Signal locks in.',null,v_group.id,null,
        'signal_one_more:'||v_group.id::text
      );
    end loop;
  end if;
  return new;
end;
$function$;

create or replace function public.notify_venue_round_opened()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_member record;
begin
  if new.state<>'open' then return new; end if;
  for v_member in
    select distinct sgm.user_id from public.signal_group_memberships sgm
    where sgm.signal_group_id=new.signal_group_id and sgm.state in ('matched','confirmed')
  loop
    perform public.enqueue_signal_notification(
      v_member.user_id,'venue_vote','CHOOSE WHERE TO GO',
      'Your Signal is voting on the meetup spot.',null,new.signal_group_id,new.id,
      'venue_vote:'||new.id::text
    );
  end loop;
  return new;
end;
$function$;

create or replace function public.notify_time_round_opened()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_member record;
begin
  if new.state<>'open' then return new; end if;
  for v_member in
    select distinct sgm.user_id from public.signal_group_memberships sgm
    where sgm.signal_group_id=new.signal_group_id and sgm.state in ('matched','confirmed')
  loop
    perform public.enqueue_signal_notification(
      v_member.user_id,'time_vote','WHAT TIMES WORK?',
      'Mark every meetup time you can make.',null,new.signal_group_id,new.id,
      'time_vote:'||new.id::text
    );
  end loop;
  return new;
end;
$function$;

create or replace function public.notify_plan_member_created()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_plan public.plans%rowtype;
begin
  if new.membership_state<>'active'::public.plan_membership_state then return new; end if;
  select p.* into v_plan from public.plans p where p.id=new.plan_id;
  if not found then return new; end if;

  if new.admission_origin='signal_lock'::public.admission_origin then
    perform public.enqueue_signal_notification(
      new.user_id,'plan_set','YOUR PLAN IS SET',
      coalesce(v_plan.title,'Your Signal is now a Plan.'),v_plan.id,v_plan.originating_signal_group_id,null,
      'plan_set:'||v_plan.id::text
    );
  elsif new.admission_origin='group_vote'::public.admission_origin then
    perform public.enqueue_signal_notification(
      new.user_id,'join_approved','YOU’RE IN',
      'The group approved your request to join.',v_plan.id,v_plan.originating_signal_group_id,null,
      'join_approved:'||v_plan.id::text||':'||new.user_id::text
    );
  end if;
  return new;
end;
$function$;

create or replace function public.notify_plan_join_request_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_member record;
  v_name text;
begin
  if new.state='pending' and (tg_op='INSERT' or old.state is distinct from new.state) then
    select coalesce(up.display_name,'Someone') into v_name from public.user_profiles up where up.user_id=new.requester_user_id;
    for v_member in
      select pm.user_id from public.plan_memberships pm
      where pm.plan_id=new.plan_id and pm.membership_state='active'::public.plan_membership_state
        and pm.user_id<>new.requester_user_id
    loop
      perform public.enqueue_signal_notification(
        v_member.user_id,'join_request',v_name||' WANTS TO JOIN',
        'Vote on this request before the 10-minute window closes.',new.plan_id,null,new.id,
        'join_request:'||new.id::text
      );
    end loop;
  end if;

  if tg_op='UPDATE' and old.state is distinct from new.state and new.state in ('approved','rejected','expired') then
    perform public.enqueue_signal_notification(
      new.requester_user_id,'join_request_result',
      case when new.state='approved' then 'YOU’RE IN' else 'JOIN REQUEST CLOSED' end,
      case when new.state='approved' then 'The group approved your request.' else 'Your request was not approved this time.' end,
      new.plan_id,null,new.id,'join_result:'||new.id::text
    );
  end if;
  return new;
end;
$function$;

create or replace function public.notify_plan_change_proposal_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_member record;
begin
  if new.state='pending' and (tg_op='INSERT' or old.state is distinct from new.state) then
    for v_member in
      select pm.user_id from public.plan_memberships pm
      where pm.plan_id=new.plan_id and pm.membership_state='active'::public.plan_membership_state
    loop
      perform public.enqueue_signal_notification(
        v_member.user_id,'plan_change_vote','PLAN CHANGE VOTE',
        case when new.change_type='venue' then 'Vote on a proposed venue change.' else 'Vote on a proposed meetup-time change.' end,
        new.plan_id,null,new.id,'plan_change_vote:'||new.id::text
      );
    end loop;
  end if;
  return new;
end;
$function$;

create or replace function public.notify_plan_history_update()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare v_member record;
begin
  if new.event_type not in ('venue_changed'::public.plan_history_event_type,'time_changed'::public.plan_history_event_type) then return new; end if;
  for v_member in
    select pm.user_id from public.plan_memberships pm
    where pm.plan_id=new.plan_id and pm.membership_state='active'::public.plan_membership_state
  loop
    perform public.enqueue_signal_notification(
      v_member.user_id,'plan_updated','PLAN UPDATED',
      case when new.event_type='venue_changed'::public.plan_history_event_type then 'The group changed the meetup venue.' else 'The group changed the meetup time.' end,
      new.plan_id,null,new.related_decision_id,'plan_updated:'||new.id::text
    );
  end loop;
  return new;
end;
$function$;

drop trigger if exists signal_group_state_notification on public.signal_groups;
create trigger signal_group_state_notification after update of state on public.signal_groups
for each row execute function public.notify_signal_group_state_change();

drop trigger if exists signal_one_more_notification on public.signal_group_memberships;
create trigger signal_one_more_notification after insert on public.signal_group_memberships
for each row execute function public.notify_signal_one_more();

drop trigger if exists venue_round_open_notification on public.signal_venue_rounds;
create trigger venue_round_open_notification after insert on public.signal_venue_rounds
for each row execute function public.notify_venue_round_opened();

drop trigger if exists time_round_open_notification on public.signal_time_rounds;
create trigger time_round_open_notification after insert on public.signal_time_rounds
for each row execute function public.notify_time_round_opened();

drop trigger if exists plan_member_created_notification on public.plan_memberships;
create trigger plan_member_created_notification after insert or update of membership_state,admission_origin on public.plan_memberships
for each row execute function public.notify_plan_member_created();

drop trigger if exists plan_join_request_notification on public.plan_join_requests;
create trigger plan_join_request_notification after insert or update of state on public.plan_join_requests
for each row execute function public.notify_plan_join_request_change();

drop trigger if exists plan_change_proposal_notification on public.plan_change_proposals;
create trigger plan_change_proposal_notification after insert or update of state on public.plan_change_proposals
for each row execute function public.notify_plan_change_proposal_change();

drop trigger if exists plan_history_update_notification on public.plan_history;
create trigger plan_history_update_notification after insert on public.plan_history
for each row execute function public.notify_plan_history_update();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
