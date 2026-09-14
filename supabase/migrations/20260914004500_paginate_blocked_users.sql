begin;

create index if not exists user_blocks_blocker_created_idx
  on public.user_blocks(blocker_user_id,created_at desc,id desc);

create or replace function public.get_my_blocked_users_page(
  p_after_blocked_at timestamptz default null,
  p_after_block_id uuid default null,
  p_limit integer default 30
)
returns table(
  block_id uuid,
  user_id uuid,
  display_name text,
  avatar_path text,
  blocked_at timestamptz
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
  if p_limit is null or p_limit<1 or p_limit>50 then
    raise exception 'invalid_blocked_user_limit' using errcode='22023';
  end if;
  return query
  select
    ub.id,
    ub.blocked_user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    ub.created_at
  from public.user_blocks ub
  join public.user_profiles up on up.user_id=ub.blocked_user_id
  where ub.blocker_user_id=v_user_id
    and (
      p_after_blocked_at is null
      or (ub.created_at,ub.id) < (p_after_blocked_at,p_after_block_id)
    )
  order by ub.created_at desc,ub.id desc
  limit p_limit;
end;
$function$;

alter function public.get_my_blocked_users_page(timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_my_blocked_users_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_my_blocked_users_page(timestamptz,uuid,integer) to authenticated;

comment on function public.get_my_blocked_users_page(timestamptz,uuid,integer)
is 'Returns a bounded cursor page of users blocked by auth.uid().';

commit;
