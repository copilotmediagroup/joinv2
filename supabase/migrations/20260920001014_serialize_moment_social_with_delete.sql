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

  -- Serialize social mutation against owner deletion. Delete locks this same
  -- Moment row before changing published -> deleted.
  select sm.author_user_id into v_author
  from public.signal_moments sm
  where sm.id=p_moment_id and sm.state='published'
  for update;

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

create or replace function public.add_signal_moment_comment(
  p_moment_id uuid,
  p_body text,
  p_parent_comment_id uuid default null,
  p_client_comment_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_id uuid;
  v_author uuid;
  v_parent_author uuid;
  v_recipient uuid;
  v_actor_name text;
  v_now timestamptz:=clock_timestamp();
  v_type text;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_client_comment_id is null then raise exception 'client_comment_id_required' using errcode='22023'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 1000 then
    raise exception 'comment_body_invalid' using errcode='22023';
  end if;

  -- Transport retries return the original authoritative comment.
  select c.id into v_id
  from public.signal_moment_comments c
  where c.author_user_id=v_user_id and c.client_comment_id=p_client_comment_id;
  if v_id is not null then return v_id; end if;

  -- Use the same Moment-row authority lock as deletion so a comment cannot
  -- pass a stale published check while the owner deletes the Moment.
  select sm.author_user_id into v_author
  from public.signal_moments sm
  where sm.id=p_moment_id and sm.state='published'
  for update;
  if v_author is null or public.users_have_block_relation(v_user_id,v_author) then
    raise exception 'moment_unavailable' using errcode='42501';
  end if;

  if p_parent_comment_id is not null then
    -- Serialize reply creation against deletion of its parent.
    select c.author_user_id into v_parent_author
    from public.signal_moment_comments c
    where c.id=p_parent_comment_id
      and c.moment_id=p_moment_id
      and c.parent_comment_id is null
      and c.deleted_at is null
    for update;
    if v_parent_author is null then raise exception 'reply_parent_invalid' using errcode='22023'; end if;
  end if;

  insert into public.signal_moment_comments(
    moment_id,author_user_id,parent_comment_id,body,client_comment_id
  ) values(
    p_moment_id,v_user_id,p_parent_comment_id,btrim(p_body),p_client_comment_id
  )
  on conflict (author_user_id,client_comment_id) where client_comment_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id
    from public.signal_moment_comments c
    where c.author_user_id=v_user_id and c.client_comment_id=p_client_comment_id;
    return v_id;
  end if;

  v_recipient:=case when p_parent_comment_id is not null then v_parent_author else v_author end;
  v_type:=case when p_parent_comment_id is not null then 'moment_reply' else 'moment_comment' end;
  if v_recipient<>v_user_id and not public.users_have_block_relation(v_user_id,v_recipient) then
    select coalesce(nullif(btrim(up.display_name),''),'Someone') into v_actor_name
    from public.user_profiles up where up.user_id=v_user_id;
    insert into public.notifications(user_id,type,title,body,related_entity_id,dedupe_key,created_at)
    values(v_recipient,v_type,case when v_type='moment_reply' then 'NEW REPLY' else 'NEW COMMENT' end,
      v_actor_name||case when v_type='moment_reply' then ' replied to your comment.' else ' commented on your Moment.' end,
      p_moment_id,'moment-social:'||v_id::text||':'||v_recipient::text,v_now)
    on conflict(user_id,dedupe_key) do nothing;
  end if;

  return v_id;
end;
$function$;

alter function public.add_signal_moment_comment(uuid,text,uuid,uuid) owner to postgres;
revoke all on function public.add_signal_moment_comment(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.add_signal_moment_comment(uuid,text,uuid,uuid) to authenticated;

comment on function public.add_signal_moment_comment(uuid,text,uuid,uuid)
is 'Retry-idempotent Moment comment/reply creation. Locks reply parents against concurrent deletion and atomically dedupes notifications.';

commit;
