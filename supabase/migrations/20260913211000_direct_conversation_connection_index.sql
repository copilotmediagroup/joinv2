begin;

create index if not exists direct_conversations_connection_id_idx
on public.direct_conversations(connection_id)
where connection_id is not null;

comment on index public.direct_conversations_connection_id_idx
is 'Covers the signal_connections foreign key so disconnect/block cleanup does not scan direct_conversations at scale.';

commit;
