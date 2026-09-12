begin;

-- SIGNAL Migration 0052: Plan roster Realtime visibility.
-- Active Plan members may observe membership rows for their own Plan so
-- Postgres Changes can invalidate the authoritative get_my_plan_members RPC.

revoke select on table public.plan_memberships from anon;

drop policy if exists plan_memberships_select_active_plan_members
  on public.plan_memberships;

create policy plan_memberships_select_active_plan_members
on public.plan_memberships
for select
to authenticated
using (
  public.is_active_plan_member(plan_id)
);

grant select on table public.plan_memberships to authenticated;

commit;
