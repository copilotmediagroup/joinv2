begin;

grant select on public.signal_connections to authenticated;

drop policy if exists signal_connections_select_participant on public.signal_connections;
create policy signal_connections_select_participant
on public.signal_connections for select to authenticated
using (auth.uid() in (user_low_id,user_high_id));

commit;
