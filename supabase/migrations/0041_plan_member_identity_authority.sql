begin;

-- ============================================================
-- SIGNAL
-- Migration 0041
-- Authenticated Plan member identity authority
-- ============================================================
-- Active Plan members may resolve the active roster for their
-- Plan. The browser never supplies a trusted user id and never
-- reads user_profiles directly for this surface.
-- ============================================================

create or replace function public.get_my_plan_members(p_plan_id uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  joined_at timestamptz,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_plan_id is null then
    raise exception 'plan_id_required' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.plan_memberships pm
    where pm.plan_id=p_plan_id
      and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
  ) then
    raise exception 'plan_membership_required' using errcode='42501';
  end if;

  return query
  select
    pm.user_id,
    coalesce(nullif(btrim(up.display_name),''),'SIGNAL member') as display_name,
    up.avatar_path,
    pm.joined_at,
    pm.user_id=v_user_id as is_me
  from public.plan_memberships pm
  join public.user_profiles up on up.user_id=pm.user_id
  where pm.plan_id=p_plan_id
    and pm.membership_state='active'::public.plan_membership_state
  order by pm.joined_at,pm.id;
end;
$function$;

alter function public.get_my_plan_members(uuid) owner to postgres;
revoke all on function public.get_my_plan_members(uuid) from public,anon;
grant execute on function public.get_my_plan_members(uuid) to authenticated;

-- Realtime membership changes invalidate roster snapshots.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='plan_memberships'
  ) then
    alter publication supabase_realtime add table public.plan_memberships;
  end if;
end $$;

commit;
