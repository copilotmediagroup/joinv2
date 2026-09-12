begin;

-- ============================================================
-- SIGNAL
-- Migration 0047
-- Targeted hot-path supporting indexes
-- ============================================================
-- Add only indexes justified by current runtime queries / FK
-- maintenance. This is intentionally not a blanket response to
-- every foreign-key advisor suggestion.
-- ============================================================

-- get_my_signal_history_summary(): caller + trusted evidence.
create index if not exists attendance_records_user_evidence_plan_idx
  on public.attendance_records(user_id,evidence_type,plan_id);

-- Notification deep-link/cascade maintenance for Plan targets.
create index if not exists notifications_related_plan_idx
  on public.notifications(related_plan_id)
  where related_plan_id is not null;

-- Notification deep-link/cascade maintenance for Signal targets.
create index if not exists notifications_related_signal_group_idx
  on public.notifications(related_signal_group_id)
  where related_signal_group_id is not null;

-- User-centric admission lookup while preserving queue indexes.
create index if not exists plan_join_requests_requester_state_idx
  on public.plan_join_requests(requester_user_id,state,requested_at desc);

commit;
