begin;

create or replace function public.enforce_single_live_plan_membership()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  if new.membership_state <> 'active'::public.plan_membership_state then
    return new;
  end if;

  -- A user has no row to lock before first admission. Serialize every path
  -- that can create/reactivate an active Plan membership on one user key.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','live_plan_membership_user_v1',new.user_id::text),0
  ));

  if exists(
    select 1
    from public.plan_memberships pm
    join public.plans p on p.id=pm.plan_id
    where pm.user_id=new.user_id
      and pm.plan_id<>new.plan_id
      and pm.membership_state='active'::public.plan_membership_state
      and p.state not in ('cancelled'::public.plan_state,'completed'::public.plan_state)
  ) then
    raise exception 'user_already_has_live_plan' using errcode='P0001';
  end if;
  return new;
end;
$function$;

alter function public.enforce_single_live_plan_membership() owner to postgres;
revoke all on function public.enforce_single_live_plan_membership() from public,anon,authenticated;

drop trigger if exists enforce_single_live_plan_membership_trigger
on public.plan_memberships;

create trigger enforce_single_live_plan_membership_trigger
before insert or update of membership_state
on public.plan_memberships
for each row
execute function public.enforce_single_live_plan_membership();

comment on function public.enforce_single_live_plan_membership()
is 'Database invariant: serializes active Plan admission per user and rejects a second simultaneous nonterminal Plan membership.';

commit;
