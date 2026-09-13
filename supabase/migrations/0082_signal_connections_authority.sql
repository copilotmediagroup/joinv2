begin;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='signal_connection_state') then
    create type public.signal_connection_state as enum ('pending','accepted','declined');
  end if;
end $$;

create table if not exists public.signal_connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.user_profiles(user_id) on delete cascade,
  user_high_id uuid not null references public.user_profiles(user_id) on delete cascade,
  requested_by uuid not null references public.user_profiles(user_id) on delete cascade,
  origin_plan_id uuid not null references public.plans(id) on delete cascade,
  state public.signal_connection_state not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signal_connections_distinct_users check (user_low_id <> user_high_id),
  constraint signal_connections_canonical_order check (user_low_id < user_high_id),
  constraint signal_connections_requester_member check (requested_by in (user_low_id,user_high_id)),
  constraint signal_connections_pair_key unique (user_low_id,user_high_id)
);

create index if not exists signal_connections_low_state_idx on public.signal_connections(user_low_id,state);
create index if not exists signal_connections_high_state_idx on public.signal_connections(user_high_id,state);
create index if not exists signal_connections_origin_plan_idx on public.signal_connections(origin_plan_id);

alter table public.signal_connections enable row level security;
revoke all on table public.signal_connections from public,anon,authenticated;
grant all on table public.signal_connections to service_role;

create or replace function public.get_my_completed_plan_connections(p_plan_id uuid)
returns table (
  connection_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  connection_state text,
  request_direction text
)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where p.id=p_plan_id
      and p.origin='signal'::public.plan_origin
      and p.state='completed'::public.plan_state
      and pm.user_id=v_user_id
      and pm.membership_state='completed'::public.plan_membership_state
  ) then
    raise exception 'completed_plan_membership_required' using errcode='42501';
  end if;

  return query
  select
    sc.id,
    pm.user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    case
      when sc.id is null then 'none'
      when sc.state='accepted'::public.signal_connection_state then 'connected'
      when sc.state='declined'::public.signal_connection_state then 'declined'
      else 'pending'
    end,
    case
      when sc.id is null then 'none'
      when sc.state<>'pending'::public.signal_connection_state then 'none'
      when sc.requested_by=v_user_id then 'outgoing'
      else 'incoming'
    end
  from public.plan_memberships pm
  join public.user_profiles up on up.user_id=pm.user_id
  left join public.signal_connections sc
    on sc.user_low_id=least(v_user_id,pm.user_id)
   and sc.user_high_id=greatest(v_user_id,pm.user_id)
  where pm.plan_id=p_plan_id
    and pm.user_id<>v_user_id
    and pm.membership_state='completed'::public.plan_membership_state
  order by pm.joined_at,pm.id;
end;
$function$;

alter function public.get_my_completed_plan_connections(uuid) owner to postgres;
revoke all on function public.get_my_completed_plan_connections(uuid) from public,anon;
grant execute on function public.get_my_completed_plan_connections(uuid) to authenticated;

create or replace function public.request_signal_connection(
  p_plan_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_low uuid;
  v_high uuid;
  v_connection public.signal_connections%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_auto_accepted boolean:=false;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then
    raise exception 'invalid_connection_target' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.plans p
    join public.plan_memberships mine on mine.plan_id=p.id and mine.user_id=v_user_id
    join public.plan_memberships theirs on theirs.plan_id=p.id and theirs.user_id=p_target_user_id
    where p.id=p_plan_id
      and p.origin='signal'::public.plan_origin
      and p.state='completed'::public.plan_state
      and mine.membership_state='completed'::public.plan_membership_state
      and theirs.membership_state='completed'::public.plan_membership_state
  ) then
    raise exception 'shared_completed_signal_required' using errcode='42501';
  end if;

  v_low:=least(v_user_id,p_target_user_id);
  v_high:=greatest(v_user_id,p_target_user_id);

  select * into v_connection
  from public.signal_connections
  where user_low_id=v_low and user_high_id=v_high
  for update;

  if not found then
    insert into public.signal_connections(
      user_low_id,user_high_id,requested_by,origin_plan_id,state,created_at,updated_at
    ) values (
      v_low,v_high,v_user_id,p_plan_id,'pending',v_now,v_now
    ) returning * into v_connection;

    insert into public.notifications(
      user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at
    ) values (
      p_target_user_id,'connection_request','STAY CONNECTED?',
      'Someone from your completed SIGNAL wants to stay connected.',
      p_plan_id,v_connection.id,
      'connection-request:'||v_connection.id::text||':'||p_target_user_id::text,v_now
    ) on conflict(user_id,dedupe_key) do nothing;

  elsif v_connection.state='pending'::public.signal_connection_state
        and v_connection.requested_by<>v_user_id then
    update public.signal_connections
    set state='accepted'::public.signal_connection_state,
        responded_at=v_now,
        updated_at=v_now
    where id=v_connection.id
    returning * into v_connection;
    v_auto_accepted:=true;

  elsif v_connection.state='declined'::public.signal_connection_state then
    raise exception 'connection_declined' using errcode='P0001';
  end if;

  if v_connection.state='accepted'::public.signal_connection_state then
    insert into public.notifications(
      user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at
    )
    select u,'connection_accepted','YOU’RE CONNECTED',
      'You stayed connected after SIGNAL.',p_plan_id,v_connection.id,
      'connection-accepted:'||v_connection.id::text||':'||u::text,v_now
    from (values(v_user_id),(p_target_user_id)) as x(u)
    on conflict(user_id,dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'connectionId',v_connection.id,
    'state',case when v_connection.state='accepted' then 'connected' else v_connection.state::text end,
    'autoAccepted',v_auto_accepted
  );
end;
$function$;

alter function public.request_signal_connection(uuid,uuid) owner to postgres;
revoke all on function public.request_signal_connection(uuid,uuid) from public,anon;
grant execute on function public.request_signal_connection(uuid,uuid) to authenticated;

create or replace function public.respond_to_signal_connection(
  p_connection_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_connection public.signal_connections%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_other_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select * into v_connection
  from public.signal_connections
  where id=p_connection_id
  for update;

  if not found then
    raise exception 'connection_not_found' using errcode='P0001';
  end if;
  if v_user_id not in (v_connection.user_low_id,v_connection.user_high_id) then
    raise exception 'connection_access_denied' using errcode='42501';
  end if;
  if v_connection.state<>'pending'::public.signal_connection_state then
    return jsonb_build_object(
      'connectionId',v_connection.id,
      'state',case when v_connection.state='accepted' then 'connected' else v_connection.state::text end
    );
  end if;
  if v_connection.requested_by=v_user_id then
    raise exception 'connection_recipient_required' using errcode='42501';
  end if;

  update public.signal_connections
  set state=case when p_accept then 'accepted'::public.signal_connection_state else 'declined'::public.signal_connection_state end,
      responded_at=v_now,
      updated_at=v_now
  where id=v_connection.id
  returning * into v_connection;

  if p_accept then
    v_other_user_id:=case when v_connection.user_low_id=v_user_id then v_connection.user_high_id else v_connection.user_low_id end;
    insert into public.notifications(
      user_id,type,title,body,related_plan_id,related_entity_id,dedupe_key,created_at
    )
    select u,'connection_accepted','YOU’RE CONNECTED',
      'You stayed connected after SIGNAL.',v_connection.origin_plan_id,v_connection.id,
      'connection-accepted:'||v_connection.id::text||':'||u::text,v_now
    from (values(v_user_id),(v_other_user_id)) as x(u)
    on conflict(user_id,dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'connectionId',v_connection.id,
    'state',case when v_connection.state='accepted' then 'connected' else v_connection.state::text end
  );
end;
$function$;

alter function public.respond_to_signal_connection(uuid,boolean) owner to postgres;
revoke all on function public.respond_to_signal_connection(uuid,boolean) from public,anon;
grant execute on function public.respond_to_signal_connection(uuid,boolean) to authenticated;

commit;
