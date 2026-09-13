begin;

create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  blocked_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_distinct_users check (blocker_user_id<>blocked_user_id),
  constraint user_blocks_pair_key unique(blocker_user_id,blocked_user_id)
);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  reported_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  reason text not null check (reason in ('harassment','threats','hate','sexual','spam','impersonation','privacy','other')),
  details text,
  state text not null default 'open' check (state in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_reports_distinct_users check (reporter_user_id<>reported_user_id),
  constraint user_reports_details_length check (details is null or char_length(details)<=2000)
);

create index user_blocks_blocked_idx on public.user_blocks(blocked_user_id,blocker_user_id);
create index user_reports_reported_state_idx on public.user_reports(reported_user_id,state,created_at desc);

alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;
revoke all on public.user_blocks,public.user_reports from public,anon,authenticated;
grant all on public.user_blocks,public.user_reports to service_role;

create or replace function public.users_have_block_relation(p_user_a uuid,p_user_b uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.user_blocks ub
    where (ub.blocker_user_id=p_user_a and ub.blocked_user_id=p_user_b)
       or (ub.blocker_user_id=p_user_b and ub.blocked_user_id=p_user_a)
  );
$$;

create or replace function public.enforce_signal_connection_block_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  if public.users_have_block_relation(new.user_low_id,new.user_high_id) then
    raise exception 'connection_blocked' using errcode='42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists signal_connection_block_guard on public.signal_connections;
create trigger signal_connection_block_guard
before insert or update of user_low_id,user_high_id,state on public.signal_connections
for each row execute function public.enforce_signal_connection_block_guard();

create or replace function public.block_user(p_target_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then raise exception 'invalid_block_target' using errcode='22023'; end if;
  if not exists(select 1 from public.user_profiles where user_id=p_target_user_id) then raise exception 'user_not_found' using errcode='P0001'; end if;

  insert into public.user_blocks(blocker_user_id,blocked_user_id)
  values(v_user_id,p_target_user_id)
  on conflict(blocker_user_id,blocked_user_id) do nothing;

  update public.direct_conversations
  set state='closed',closed_at=coalesce(closed_at,clock_timestamp()),updated_at=clock_timestamp()
  where user_low_id=least(v_user_id,p_target_user_id)
    and user_high_id=greatest(v_user_id,p_target_user_id)
    and state='active';

  delete from public.signal_connections
  where user_low_id=least(v_user_id,p_target_user_id)
    and user_high_id=greatest(v_user_id,p_target_user_id);

  return true;
end;
$function$;

create or replace function public.unblock_user(p_target_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  delete from public.user_blocks where blocker_user_id=v_user_id and blocked_user_id=p_target_user_id;
  return found;
end;
$function$;

create or replace function public.report_user(p_target_user_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_user_id uuid:=auth.uid(); v_report_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then raise exception 'invalid_report_target' using errcode='22023'; end if;
  if p_reason not in ('harassment','threats','hate','sexual','spam','impersonation','privacy','other') then raise exception 'invalid_report_reason' using errcode='22023'; end if;
  if p_details is not null and char_length(p_details)>2000 then raise exception 'report_details_too_long' using errcode='22023'; end if;
  if not exists(select 1 from public.user_profiles where user_id=p_target_user_id) then raise exception 'user_not_found' using errcode='P0001'; end if;

  insert into public.user_reports(reporter_user_id,reported_user_id,reason,details)
  values(v_user_id,p_target_user_id,p_reason,nullif(btrim(p_details),'')) returning id into v_report_id;
  return v_report_id;
end;
$function$;

create or replace function public.get_my_blocked_users()
returns table(block_id uuid,user_id uuid,display_name text,avatar_path text,blocked_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select ub.id,ub.blocked_user_id,coalesce(up.display_name,'SIGNAL member'),up.avatar_path,ub.created_at
  from public.user_blocks ub join public.user_profiles up on up.user_id=ub.blocked_user_id
  where ub.blocker_user_id=auth.uid()
  order by ub.created_at desc;
$$;

alter function public.users_have_block_relation(uuid,uuid) owner to postgres;
alter function public.enforce_signal_connection_block_guard() owner to postgres;
alter function public.block_user(uuid) owner to postgres;
alter function public.unblock_user(uuid) owner to postgres;
alter function public.report_user(uuid,text,text) owner to postgres;
alter function public.get_my_blocked_users() owner to postgres;
revoke all on function public.users_have_block_relation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.enforce_signal_connection_block_guard() from public,anon,authenticated;
revoke all on function public.block_user(uuid) from public,anon;
revoke all on function public.unblock_user(uuid) from public,anon;
revoke all on function public.report_user(uuid,text,text) from public,anon;
revoke all on function public.get_my_blocked_users() from public,anon;
grant execute on function public.block_user(uuid),public.unblock_user(uuid),public.report_user(uuid,text,text),public.get_my_blocked_users() to authenticated;

commit;
