begin;

create policy signal_connections_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1)='signal-connections'
  and split_part((select realtime.topic()),':',2)=(select auth.uid())::text
);

create or replace function public.broadcast_signal_connection_refresh()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_low uuid;
  v_high uuid;
begin
  v_low:=coalesce(new.user_low_id,old.user_low_id);
  v_high:=coalesce(new.user_high_id,old.user_high_id);
  perform realtime.send(jsonb_build_object('changed',true),'refresh','signal-connections:'||v_low::text,true);
  if v_high is distinct from v_low then
    perform realtime.send(jsonb_build_object('changed',true),'refresh','signal-connections:'||v_high::text,true);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_signal_connection_refresh() owner to postgres;
revoke all on function public.broadcast_signal_connection_refresh() from public,anon,authenticated;

drop trigger if exists signal_connections_ui_refresh on public.signal_connections;
create trigger signal_connections_ui_refresh
after insert or update or delete on public.signal_connections
for each row execute function public.broadcast_signal_connection_refresh();

alter publication supabase_realtime drop table public.signal_connections;

comment on function public.broadcast_signal_connection_refresh()
is 'Server-only data-free private invalidation for each participant in a SIGNAL connection pair.';

commit;
