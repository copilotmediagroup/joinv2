begin;

-- ============================================================
-- SIGNAL
-- Migration 0066
-- Authenticated forming-Signal participant identity authority
-- ============================================================
-- A matched/confirmed member may resolve the visible roster for
-- their own live Signal. The browser never reads user_profiles
-- directly and never supplies a trusted user id.
-- ============================================================

create or replace function public.get_my_signal_participants(
  p_signal_group_id uuid
)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  membership_state public.signal_group_membership_state,
  matched_at timestamptz,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_activity_slug text;
  v_group_state public.signal_group_state;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_signal_group_id is null then
    raise exception 'signal_group_id_required' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.signal_group_memberships sgm
    where sgm.signal_group_id=p_signal_group_id
      and sgm.user_id=v_user_id
      and sgm.state in ('matched','confirmed')
  ) then
    raise exception 'signal_membership_required' using errcode='42501';
  end if;

  select a.slug,sg.state
  into v_activity_slug,v_group_state
  from public.signal_groups sg
  join public.activities a on a.id=sg.activity_id
  where sg.id=p_signal_group_id;

  -- Chill is a private reciprocal date. While only one person is waiting,
  -- expose only the caller's own identity. The pair becomes mutually visible
  -- only after the authoritative group reaches LOCKED at 2/2.
  if v_activity_slug='chill' and v_group_state='forming' then
    return query
    select
      sgm.user_id,
      coalesce(nullif(btrim(up.display_name),''),'SIGNAL member') as display_name,
      up.avatar_path,
      sgm.state,
      sgm.matched_at,
      true as is_me
    from public.signal_group_memberships sgm
    join public.user_profiles up on up.user_id=sgm.user_id
    where sgm.signal_group_id=p_signal_group_id
      and sgm.user_id=v_user_id
      and sgm.state in ('matched','confirmed');
    return;
  end if;

  return query
  select
    sgm.user_id,
    coalesce(nullif(btrim(up.display_name),''),'SIGNAL member') as display_name,
    up.avatar_path,
    sgm.state,
    sgm.matched_at,
    sgm.user_id=v_user_id as is_me
  from public.signal_group_memberships sgm
  join public.user_profiles up
    on up.user_id=sgm.user_id
  where sgm.signal_group_id=p_signal_group_id
    and sgm.state in ('matched','confirmed')
  order by sgm.matched_at,sgm.id;
end;
$function$;

alter function public.get_my_signal_participants(uuid) owner to postgres;
revoke all on function public.get_my_signal_participants(uuid) from public,anon;
grant execute on function public.get_my_signal_participants(uuid) to authenticated;

comment on function public.get_my_signal_participants(uuid)
is 'Returns real display identity for the caller live Signal. Forming Chill groups expose only the caller until the reciprocal 2/2 pair is authoritatively locked.';

commit;