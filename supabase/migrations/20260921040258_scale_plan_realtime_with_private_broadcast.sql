begin;

-- Plan UI invalidation is data-free. At scale, use private Broadcast instead
-- of Postgres Changes so one row mutation is not authorized separately for
-- every subscribed browser.
drop policy if exists plan_ui_broadcast_receive on realtime.messages;
create policy plan_ui_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and split_part((select realtime.topic()),':',1) in ('plan-governance','plan-members')
  and case
    when split_part((select realtime.topic()),':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      then public.is_active_plan_member(split_part((select realtime.topic()),':',2)::uuid)
    else false
  end
);

create or replace function public.broadcast_plan_ui_refresh()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_plan_id uuid;
begin
  v_plan_id:=coalesce(new.plan_id,old.plan_id);
  if v_plan_id is null then return coalesce(new,old); end if;

  perform realtime.send(
    jsonb_build_object('changed',true),
    'refresh',
    'plan-governance:'||v_plan_id::text,
    true
  );

  if tg_table_name='plan_memberships' then
    perform realtime.send(
      jsonb_build_object('changed',true),
      'refresh',
      'plan-members:'||v_plan_id::text,
      true
    );
  end if;

  return coalesce(new,old);
end;
$function$;

alter function public.broadcast_plan_ui_refresh() owner to postgres;
revoke all on function public.broadcast_plan_ui_refresh() from public,anon,authenticated;

drop trigger if exists plan_join_requests_ui_refresh on public.plan_join_requests;
create trigger plan_join_requests_ui_refresh
after insert or update or delete on public.plan_join_requests
for each row execute function public.broadcast_plan_ui_refresh();

drop trigger if exists plan_change_proposals_ui_refresh on public.plan_change_proposals;
create trigger plan_change_proposals_ui_refresh
after insert or update or delete on public.plan_change_proposals
for each row execute function public.broadcast_plan_ui_refresh();

drop trigger if exists plan_memberships_ui_refresh on public.plan_memberships;
create trigger plan_memberships_ui_refresh
after insert or update or delete on public.plan_memberships
for each row execute function public.broadcast_plan_ui_refresh();

-- These browser subscriptions have moved to private Broadcast. Removing them
-- from logical replication avoids the per-subscriber authorization fan-out of
-- Postgres Changes.
alter publication supabase_realtime drop table public.plan_join_requests;
alter publication supabase_realtime drop table public.plan_change_proposals;
alter publication supabase_realtime drop table public.plan_memberships;

commit;
