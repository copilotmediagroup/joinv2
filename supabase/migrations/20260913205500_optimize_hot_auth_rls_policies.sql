begin;

drop policy if exists direct_conversations_select_active_participant
on public.direct_conversations;
create policy direct_conversations_select_active_participant
on public.direct_conversations
for select to authenticated
using (
  state='active'
  and ((select auth.uid())=user_low_id or (select auth.uid())=user_high_id)
  and exists (
    select 1 from public.signal_connections sc
    where sc.id=direct_conversations.connection_id
      and sc.state='accepted'::public.signal_connection_state
      and ((select auth.uid())=sc.user_low_id or (select auth.uid())=sc.user_high_id)
  )
);

drop policy if exists direct_messages_select_active_participant
on public.direct_messages;
create policy direct_messages_select_active_participant
on public.direct_messages
for select to authenticated
using (
  exists (
    select 1
    from public.direct_conversations dc
    join public.signal_connections sc
      on sc.id=dc.connection_id
     and sc.state='accepted'::public.signal_connection_state
    where dc.id=direct_messages.conversation_id      and dc.state='active'
      and ((select auth.uid())=dc.user_low_id or (select auth.uid())=dc.user_high_id)
  )
);

drop policy if exists signal_connections_select_participant
on public.signal_connections;
create policy signal_connections_select_participant
on public.signal_connections
for select to authenticated
using (
  (select auth.uid())=user_low_id
  or (select auth.uid())=user_high_id
);

comment on policy direct_conversations_select_active_participant
on public.direct_conversations
is 'Active connected participants may read direct conversations; auth.uid is init-plan optimized.';
comment on policy direct_messages_select_active_participant
on public.direct_messages
is 'Active connected participants may read direct messages; auth.uid is init-plan optimized.';
comment on policy signal_connections_select_participant
on public.signal_connections
is 'Connection participants may read their rows; auth.uid is init-plan optimized.';

commit;
