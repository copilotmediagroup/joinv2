begin;

create or replace function public.broadcast_signal_discovery_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_topic text;
  new_topic text;
begin
  if tg_op <> 'INSERT' then
    old_topic := 'signal-discovery:' || old.city_id::text;
  end if;

  if tg_op <> 'DELETE' then
    new_topic := 'signal-discovery:' || new.city_id::text;
  end if;

  if tg_op = 'UPDATE'
     and old.city_id is not distinct from new.city_id
     and old.activity_id is not distinct from new.activity_id
     and old.state is not distinct from new.state
     and old.expires_at is not distinct from new.expires_at then
    return new;
  end if;

  -- This event contains no user or Signal data. It is only an invalidation
  -- notice. The authenticated RPC remains the sole authority for counts,
  -- block filtering, locality, and avatar visibility.
  if old_topic is not null then
    perform realtime.send('{"source":"signal_intents"}'::jsonb, 'refresh', old_topic, false);
  end if;

  if new_topic is not null and new_topic is distinct from old_topic then
    perform realtime.send('{"source":"signal_intents"}'::jsonb, 'refresh', new_topic, false);
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.broadcast_signal_discovery_change()
is 'Emits data-free public city-topic invalidations for live Discovery social proof; clients re-fetch authoritative block-safe counts via authenticated RPC.';

commit;
