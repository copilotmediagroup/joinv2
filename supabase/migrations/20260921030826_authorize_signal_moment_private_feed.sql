begin;

create schema if not exists signal_private;
revoke all on schema signal_private from public,anon;
grant usage on schema signal_private to authenticated;

create or replace function signal_private.current_user_has_complete_profile()
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $function$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id=(select auth.uid())
      and up.completion_state='complete'::public.profile_completion_state
  );
$function$;

alter function signal_private.current_user_has_complete_profile() owner to postgres;
revoke all on function signal_private.current_user_has_complete_profile() from public,anon;
grant execute on function signal_private.current_user_has_complete_profile() to authenticated;

drop policy if exists signal_moments_feed_broadcast_receive on realtime.messages;
create policy signal_moments_feed_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  extension='broadcast'
  and (select realtime.topic())='signal-moments:feed'
  and (select signal_private.current_user_has_complete_profile())
);

commit;
