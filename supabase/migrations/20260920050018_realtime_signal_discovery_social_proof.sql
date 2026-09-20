begin;

create or replace function public.get_my_signal_discovery_realtime_topic()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'signal-discovery:' || up.home_city_id::text
  from public.user_profiles up
  join public.cities c on c.id = up.home_city_id
  join public.states s on s.id = c.state_id
  where up.user_id = auth.uid()
    and up.completion_state = 'complete'
    and c.is_active = true
    and s.is_active = true
  limit 1;
$$;

revoke all on function public.get_my_signal_discovery_realtime_topic() from public;
grant execute on function public.get_my_signal_discovery_realtime_topic() to authenticated;

drop policy if exists signal_discovery_broadcast_receive on realtime.messages;
create policy signal_discovery_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.user_profiles up
    where up.user_id = (select auth.uid())
      and up.completion_state = 'complete'
      and (select realtime.topic()) = 'signal-discovery:' || up.home_city_id::text
  )
);

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

  if old_topic is not null then
    perform realtime.send('{"source":"signal_intents"}'::jsonb, 'refresh', old_topic, true);
  end if;

  if new_topic is not null and new_topic is distinct from old_topic then
    perform realtime.send('{"source":"signal_intents"}'::jsonb, 'refresh', new_topic, true);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists signal_intents_discovery_broadcast on public.signal_intents;
create trigger signal_intents_discovery_broadcast
after insert or update or delete on public.signal_intents
for each row execute function public.broadcast_signal_discovery_change();

create or replace function public.get_my_signal_discovery()
returns table (
  activity_id uuid,
  activity_slug text,
  activity_name text,
  active_count integer,
  preview_avatar_paths text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with authoritative_user as (
    select up.user_id, up.home_city_id
    from public.user_profiles up
    join public.cities c on c.id = up.home_city_id
    join public.states s on s.id = c.state_id
    where up.user_id = auth.uid()
      and up.completion_state = 'complete'
      and c.is_active = true
      and s.is_active = true
  ),
  active_intents as (
    select si.activity_id, si.user_id, si.created_at, up.avatar_path
    from public.signal_intents si
    join authoritative_user au on au.home_city_id = si.city_id
    join public.user_profiles up on up.user_id = si.user_id
    where si.state in ('active', 'assigned')
      and si.expires_at > now()
      and up.completion_state = 'complete'
      and not exists (
        select 1 from public.user_blocks ub
        where ub.blocker_user_id = au.user_id and ub.blocked_user_id = si.user_id
      )
      and not exists (
        select 1 from public.user_blocks ub
        where ub.blocker_user_id = si.user_id and ub.blocked_user_id = au.user_id
      )
  ),
  activity_counts as (
    select ai.activity_id, count(distinct ai.user_id)::integer as active_count
    from active_intents ai
    group by ai.activity_id
  ),
  ranked_avatar_candidates as (
    select ai.activity_id, ai.user_id, ai.avatar_path, ai.created_at,
      row_number() over (
        partition by ai.activity_id, ai.user_id
        order by ai.created_at desc
      ) as user_activity_rank
    from active_intents ai
    where ai.avatar_path is not null
      and nullif(btrim(ai.avatar_path), '') is not null
  ),
  preview_candidates as (
    select rac.activity_id, rac.avatar_path, rac.created_at,
      row_number() over (
        partition by rac.activity_id
        order by rac.created_at desc, rac.user_id
      ) as preview_rank
    from ranked_avatar_candidates rac
    where rac.user_activity_rank = 1
  ),
  activity_previews as (
    select pc.activity_id,
      array_agg(pc.avatar_path order by pc.preview_rank) as preview_avatar_paths
    from preview_candidates pc
    where pc.preview_rank <= 4
    group by pc.activity_id
  )
  select a.id, a.slug, a.name,
    coalesce(ac.active_count, 0)::integer,
    coalesce(ap.preview_avatar_paths, array[]::text[])
  from authoritative_user au
  cross join public.activities a
  left join activity_counts ac on ac.activity_id = a.id
  left join activity_previews ap on ap.activity_id = a.id
  where a.is_active = true
  order by a.name, a.id;
$$;

comment on function public.get_my_signal_discovery()
is 'Returns block-safe live discovery social proof for the caller home city, counting both searching and assigned unexpired Signal members.';

commit;
