begin;

-- Direct inbox pages are bounded, but unread counts previously filtered the
-- generic (conversation_id, read_at) index by sender after the fact. At scale,
-- a busy thread could scan every unread row just to count the peer's messages.
create index if not exists direct_messages_unread_by_sender_idx
on public.direct_messages(conversation_id,sender_user_id)
where read_at is null;

commit;
