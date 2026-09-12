begin;

-- SIGNAL Migration 0048: targeted FK indexes for high-churn runtime tables.
-- These support vote churn, membership/user cleanup, message sender lookup,
-- and notification decision linkage without blanket-indexing every FK.

create index if not exists signal_venue_votes_user_idx
  on public.signal_venue_votes(user_id);

create index if not exists signal_time_availability_user_idx
  on public.signal_time_availability(user_id);

create index if not exists plan_join_request_votes_user_idx
  on public.plan_join_request_votes(user_id);

create index if not exists plan_change_votes_user_idx
  on public.plan_change_votes(user_id);

create index if not exists plan_change_proposals_proposer_idx
  on public.plan_change_proposals(proposer_user_id);

create index if not exists messages_sender_user_idx
  on public.messages(sender_user_id);

create index if not exists notifications_related_decision_idx
  on public.notifications(related_decision_id)
  where related_decision_id is not null;

commit;
