begin;

create or replace function public.get_signal_moment_comments_page(
  p_moment_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table(
  comment_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  body text,
  created_at timestamptz,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_comment_limit' using errcode='22023';
  end if;

  if not (
    (p_before_created_at is null and p_before_id is null)
    or
    (p_before_created_at is not null and p_before_id is not null)
  ) then
    raise exception 'invalid_comment_cursor' using errcode='22023';
  end if;

  if not exists (
    select 1
    from public.signal_moments sm
    where sm.id = p_moment_id
      and sm.state = 'published'
      and not public.users_have_block_relation(v_user_id, sm.author_user_id)
  ) then
    raise exception 'moment_unavailable' using errcode='42501';
  end if;

  return query
  select
    c.id,
    c.parent_comment_id,
    c.author_user_id,
    coalesce(up.display_name,'SIGNAL member'),
    up.avatar_path,
    c.body,
    c.created_at,
    c.author_user_id = v_user_id
  from public.signal_moment_comments c
  join public.user_profiles up on up.user_id = c.author_user_id
  where c.moment_id = p_moment_id
    and c.deleted_at is null
    and not public.users_have_block_relation(v_user_id,c.author_user_id)
    and (
      p_before_created_at is null
      or (c.created_at,c.id) < (p_before_created_at,p_before_id)
    )
  order by c.created_at desc,c.id desc
  limit p_limit;
end;
$function$;

alter function public.get_signal_moment_comments_page(uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.get_signal_moment_comments_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_signal_moment_comments_page(uuid,timestamptz,uuid,integer) to authenticated;

-- Retire the unbounded browser endpoint. The paged endpoint is the only
-- authenticated read path for Moment comments.
revoke execute on function public.get_signal_moment_comments(uuid) from authenticated;

comment on function public.get_signal_moment_comments_page(uuid,timestamptz,uuid,integer)
is 'Returns a bounded newest-first page of visible Signal Moment comments using a stable created_at/id cursor.';

commit;
