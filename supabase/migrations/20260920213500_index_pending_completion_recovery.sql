begin;
create index if not exists plan_member_outing_completions_pending_user_completed_idx
on public.plan_member_outing_completions(user_id,completed_at desc,plan_id)
where feedback_at is null;
commit;
