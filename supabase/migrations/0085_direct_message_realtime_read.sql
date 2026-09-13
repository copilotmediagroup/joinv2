begin;

grant select on public.direct_conversations,public.direct_messages to authenticated;

drop policy if exists direct_conversations_select_active_participant on public.direct_conversations;
create policy direct_conversations_select_active_participant
on public.direct_conversations for select to authenticated
using (
  state='active'
  and auth.uid() in (user_low_id,user_high_id)
  and exists (
    select 1 from public.signal_connections sc
    where sc.id=connection_id
      and sc.state='accepted'::public.signal_connection_state
      and auth.uid() in (sc.user_low_id,sc.user_high_id)
  )
);

drop policy if exists direct_messages_select_active_participant on public.direct_messages;
create policy direct_messages_select_active_participant
on public.direct_messages for select to authenticated
using (
  exists (
    select 1
    from public.direct_conversations dc
    join public.signal_connections sc
      on sc.id=dc.connection_id
     and sc.state='accepted'::public.signal_connection_state
    where dc.id=conversation_id
      and dc.state='active'
      and auth.uid() in (dc.user_low_id,dc.user_high_id)
  )
);

commit;
