begin;

create policy notifications_broadcast_receive
on realtime.messages for select to authenticated
using (
  extension='broadcast'
  and split_part((select realtime.topic()),':',1)='notifications'
  and split_part((select realtime.topic()),':',2)=(select auth.uid())::text
);

create or replace function public.broadcast_notification_refresh()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid;
begin
  v_user_id:=coalesce(new.user_id,old.user_id);
  perform realtime.send(jsonb_build_object('changed',true),'refresh','notifications:'||v_user_id::text,true);
  if tg_op='DELETE' then return old; end if;
  return new;
end;$function$;

alter function public.broadcast_notification_refresh() owner to postgres;
revoke all on function public.broadcast_notification_refresh() from public,anon,authenticated;

drop trigger if exists notifications_ui_refresh on public.notifications;
create trigger notifications_ui_refresh
after insert or update or delete on public.notifications
for each row execute function public.broadcast_notification_refresh();

alter publication supabase_realtime drop table public.notifications;

comment on function public.broadcast_notification_refresh()
is 'Server-only data-free private invalidation for the notification owner.';

commit;
