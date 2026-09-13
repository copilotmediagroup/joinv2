begin;

create index if not exists direct_messages_sender_user_id_idx
  on public.direct_messages(sender_user_id);

create index if not exists signal_connections_requested_by_idx
  on public.signal_connections(requested_by);

comment on index public.direct_messages_sender_user_id_idx
is 'Supports sender-owned cleanup and moderation operations as direct message volume grows.';

comment on index public.signal_connections_requested_by_idx
is 'Supports requester-owned connection cleanup and account lifecycle operations.';

commit;
