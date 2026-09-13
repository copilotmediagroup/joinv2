begin;

create or replace function public.is_my_signal_group_block_compatible(
  p_signal_group_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
  select not exists (
    select 1
    from public.signal_group_memberships sgm
    join public.user_blocks ub
      on (ub.blocker_user_id=p_user_id and ub.blocked_user_id=sgm.user_id)
      or (ub.blocked_user_id=p_user_id and ub.blocker_user_id=sgm.user_id)
    where sgm.signal_group_id=p_signal_group_id
      and sgm.state in ('matched','confirmed')
  );
$$;

alter function public.is_my_signal_group_block_compatible(uuid,uuid) owner to postgres;
revoke all on function public.is_my_signal_group_block_compatible(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_my_signal_group_block_compatible(uuid,uuid) to service_role;
comment on function public.is_my_signal_group_block_compatible(uuid,uuid)
is 'Service-role-only internal block compatibility predicate used by Signal formation. Caller identity is supplied by the authenticated Edge Function resolver.';

commit;
