begin;

create or replace function public.toggle_signal_moment_signal(p_moment_id uuid)
returns table(signaled boolean,signal_count integer)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_author uuid;
  v_actor_name text;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;

  select sm.author_user_id into v_author
  from public.signal_moments sm
  where sm.id=p_moment_id and sm.state='published';

  if v_author is null then raise exception 'published_moment_required' using errcode='P0001'; end if;
  if public.users_have_block_relation(v_user_id,v_author) then raise exception 'moment_unavailable' using errcode='42501'; end if;

  -- A toggle is a read-modify-write operation. Serialize the exact
  -- moment/user key before observing reaction existence so simultaneous
  -- browser retries cannot both choose the insert branch.
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|','signal_moment_signal_v1',p_moment_id::text,v_user_id::text),0)
  );

  if exists(select 1 from public.signal_moment_signals s where s.moment_id=p_moment_id and s.user_id=v_user_id) then
    delete from public.signal_moment_signals s where s.moment_id=p_moment_id and s.user_id=v_user_id;
    signaled:=false;
    delete from public.notifications n
    where n.user_id=v_author and n.type='moment_signal' and n.related_entity_id=p_moment_id
      and n.dedupe_key='moment-signal:'||p_moment_id::text||':'||v_user_id::text;
  else
    insert into public.signal_moment_signals(moment_id,user_id) values(p_moment_id,v_user_id);
    signaled:=true;
    if v_author<>v_user_id then
      select coalesce(nullif(btrim(up.display_name),''),'Someone') into v_actor_name
      from public.user_profiles up where up.user_id=v_user_id;
      insert into public.notifications(user_id,type,title,body,related_entity_id,dedupe_key,created_at)
      values(v_author,'moment_signal','NEW SIGNAL',v_actor_name||' sent a SIGNAL to your Moment.',p_moment_id,
        'moment-signal:'||p_moment_id::text||':'||v_user_id::text,v_now)
      on conflict(user_id,dedupe_key) do update
      set state='unread',read_at=null,created_at=excluded.created_at,body=excluded.body;
    end if;
  end if;

  select count(*)::integer into signal_count
  from public.signal_moment_signals s where s.moment_id=p_moment_id;
  return next;
end;
$function$;

alter function public.toggle_signal_moment_signal(uuid) owner to postgres;
revoke all on function public.toggle_signal_moment_signal(uuid) from public,anon;
grant execute on function public.toggle_signal_moment_signal(uuid) to authenticated;

comment on function public.toggle_signal_moment_signal(uuid)
is 'Serializes each Moment/user reaction toggle, preserving one reaction row and its matching author notification under concurrent calls.';

commit;
