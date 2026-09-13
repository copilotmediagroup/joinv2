begin;

update public.plan_memberships pm
set membership_state='completed'::public.plan_membership_state,
    updated_at=clock_timestamp()
from public.plans p
where p.id=pm.plan_id
  and p.state='completed'::public.plan_state
  and pm.membership_state='active'::public.plan_membership_state;

update public.conversation_membership_intervals cmi
set ended_at=coalesce(
  cmi.ended_at,
  coalesce(p.completed_at,p.updated_at,clock_timestamp())
)
from public.conversations c
join public.plans p on p.id=c.plan_id
where cmi.conversation_id=c.id
  and p.state='completed'::public.plan_state
  and cmi.ended_at is null;

commit;
