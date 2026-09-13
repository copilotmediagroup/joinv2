begin;

create index if not exists signal_intents_discovery_active_city_idx
  on public.signal_intents(city_id,expires_at,activity_id,user_id,created_at desc)
  where state='active'::public.signal_intent_state;

comment on index public.signal_intents_discovery_active_city_idx
is 'Supports the home Discovery scan of active, unexpired Signal intent social proof within one city.';

commit;
