begin;

-- Migration 0046: cache auth.uid() once per RLS query plan on hot paths.

drop policy if exists signal_intents_select_own on public.signal_intents;
create policy signal_intents_select_own
on public.signal_intents
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists conversations_select_authorized_history on public.conversations;
create policy conversations_select_authorized_history
on public.conversations
for select to authenticated
using (
  exists (
    select 1
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id=conversations.id
      and cmi.user_id=(select auth.uid())
  )
);

drop policy if exists conversation_membership_intervals_select_own on public.conversation_membership_intervals;
create policy conversation_membership_intervals_select_own
on public.conversation_membership_intervals
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists messages_select_authorized_interval on public.messages;
create policy messages_select_authorized_interval
on public.messages
for select to authenticated
using (
  exists (
    select 1
    from public.conversation_membership_intervals cmi
    where cmi.conversation_id=messages.conversation_id
      and cmi.user_id=(select auth.uid())
      and cmi.started_at<=messages.sent_at
      and (cmi.ended_at is null or messages.sent_at<cmi.ended_at)
  )
);

drop policy if exists plan_join_requests_select_authorized on public.plan_join_requests;
create policy plan_join_requests_select_authorized
on public.plan_join_requests
for select to authenticated
using (
  requester_user_id=(select auth.uid())
  or public.is_active_plan_member(plan_id)
);

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select to authenticated
using (user_id=(select auth.uid()));

commit;
