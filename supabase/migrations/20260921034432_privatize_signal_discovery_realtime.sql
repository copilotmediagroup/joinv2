begin;

create or replace function public.broadcast_signal_discovery_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  old_topic text;
  new_topic text;
begin
  if tg_op <> 'INSERT' then old_topic := 'signal-discovery:' || old.city_id::text; end if;
  if tg_op <> 'DELETE' then new_topic := 'signal-discovery:' || new.city_id::text; end if;

  if tg_op='UPDATE'
     and old.city_id is not distinct from new.city_id
     and old.activity_id is not distinct from new.activity_id
     and old.state is not distinct from new.state
     and old.expires_at is not distinct from new.expires_at then
    return new;
  end if;

  -- Content-free invalidation only. The authenticated discovery RPC remains
  -- authoritative for counts, blocks, Chill privacy, and avatar visibility.
  if old_topic is not null then
    perform realtime.send(jsonb_build_object('changed',true),'refresh',old_topic,true);
  end if;
  if new_topic is not null and new_topic is distinct from old_topic then
    perform realtime.send(jsonb_build_object('changed',true),'refresh',new_topic,true);
  end if;
  return coalesce(new,old);
end;
$function$;

alter function public.broadcast_signal_discovery_change() owner to postgres;
revoke all on function public.broadcast_signal_discovery_change() from public,anon,authenticated;

comment on function public.broadcast_signal_discovery_change()
is 'Emits data-free private city-topic invalidations; clients re-fetch authoritative block-safe discovery counts via authenticated RPC.';

commit;
