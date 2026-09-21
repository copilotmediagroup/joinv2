begin;

drop policy if exists plan_ui_broadcast_receive on realtime.messages;
create policy plan_ui_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and split_part((select realtime.topic()),':',1) in ('plan-governance','plan-members','plan-live')
  and case
    when split_part((select realtime.topic()),':',2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      then public.is_active_plan_member(split_part((select realtime.topic()),':',2)::uuid)
    else false
  end
);

create or replace function public.broadcast_live_plan_refresh()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_plan_id uuid;
begin
  if tg_table_name='plans' then
    v_plan_id:=coalesce(new.id,old.id);
  else
    v_plan_id:=coalesce(new.plan_id,old.plan_id);
  end if;

  if v_plan_id is null then return coalesce(new,old); end if;

  perform realtime.send(
    jsonb_build_object('changed',true),
    'refresh',
    'plan-live:'||v_plan_id::text,
    true
  );

  return coalesce(new,old);
end;
$function$;

alter function public.broadcast_live_plan_refresh() owner to postgres;
revoke all on function public.broadcast_live_plan_refresh() from public,anon,authenticated;

commit;
