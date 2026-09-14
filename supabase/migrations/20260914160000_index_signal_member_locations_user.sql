begin;

create index if not exists signal_member_locations_user_id_idx
  on public.signal_member_locations(user_id);

comment on index public.signal_member_locations_user_id_idx
is 'Supports user-owned private location cleanup and user FK operations without scanning all Signal location samples.';

commit;
