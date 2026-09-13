begin;

create or replace function public.get_my_admin_capabilities()
returns table(capability text)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select ag.capability
  from public.admin_grants ag
  where auth.uid() is not null
    and ag.user_id=auth.uid()
    and ag.revoked_at is null
  order by ag.capability;
$$;

alter function public.get_my_admin_capabilities() owner to postgres;
revoke all on function public.get_my_admin_capabilities() from public,anon;
grant execute on function public.get_my_admin_capabilities() to authenticated;

comment on function public.get_my_admin_capabilities()
is 'Returns only the active administrative capability names granted to the authenticated caller.';

commit;