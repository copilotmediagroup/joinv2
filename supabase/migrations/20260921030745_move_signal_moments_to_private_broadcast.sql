begin;

-- Signal Moment rows are RPC-only. Do not widen table SELECT grants merely to
-- support Realtime Postgres Changes. Broadcast a content-free invalidation
-- event instead and let the existing RPC projection enforce feed privacy.
alter publication supabase_realtime drop table
  public.signal_moments,
  public.signal_moment_signals,
  public.signal_moment_comments;

drop policy if exists signal_moments_feed_broadcast_receive on realtime.messages;
create policy signal_moments_feed_broadcast_receive
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) = 'signal-moments:feed'
  and exists (
    select 1
    from public.user_profiles up
    where up.user_id = (select auth.uid())
      and up.completion_state = 'complete'::public.profile_completion_state
  )
);

create or replace function public.broadcast_signal_moment_feed_change()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  perform realtime.send(
    jsonb_build_object('changed',true),
    'changed',
    'signal-moments:feed',
    true
  );
  return null;
end;
$function$;

alter function public.broadcast_signal_moment_feed_change() owner to postgres;
revoke all on function public.broadcast_signal_moment_feed_change() from public,anon,authenticated;

drop trigger if exists signal_moments_feed_changed on public.signal_moments;
create trigger signal_moments_feed_changed
after insert or update or delete on public.signal_moments
for each statement execute function public.broadcast_signal_moment_feed_change();

drop trigger if exists signal_moment_signals_feed_changed on public.signal_moment_signals;
create trigger signal_moment_signals_feed_changed
after insert or update or delete on public.signal_moment_signals
for each statement execute function public.broadcast_signal_moment_feed_change();

drop trigger if exists signal_moment_comments_feed_changed on public.signal_moment_comments;
create trigger signal_moment_comments_feed_changed
after insert or update or delete on public.signal_moment_comments
for each statement execute function public.broadcast_signal_moment_feed_change();

commit;
