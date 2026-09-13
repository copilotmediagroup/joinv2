begin;

-- Product contract: blocking is private/social isolation, not group expulsion.
-- Existing Signal and Plan memberships must remain intact when a block is created.
do $$
begin
  if pg_get_functiondef('public.block_user(uuid)'::regprocedure)
       ilike '%signal_group_memberships%'
     or pg_get_functiondef('public.block_user(uuid)'::regprocedure)
       ilike '%plan_memberships%'
  then
    raise exception 'block_user_must_not_mutate_active_memberships';
  end if;
end;
$$;

comment on function public.block_user(uuid) is
  'Blocks private/social interaction and future matching. Intentionally does not remove either user from an existing Signal or Plan membership.';

commit;
