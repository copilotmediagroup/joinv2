begin;

create or replace function public.can_receive_signal_discovery_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.user_profiles up
    join public.cities c on c.id=up.home_city_id and c.is_active=true
    join public.states s on s.id=c.state_id and s.is_active=true
    where up.user_id=auth.uid()
      and up.completion_state='complete'
      and p_topic='signal-discovery:'||up.home_city_id::text
  );
$function$;

alter function public.can_receive_signal_discovery_topic(text) owner to postgres;
revoke all on function public.can_receive_signal_discovery_topic(text) from public,anon;
grant execute on function public.can_receive_signal_discovery_topic(text) to authenticated;

drop policy if exists signal_discovery_broadcast_receive on realtime.messages;
create policy signal_discovery_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and public.can_receive_signal_discovery_topic((select realtime.topic()))
);

commit;
