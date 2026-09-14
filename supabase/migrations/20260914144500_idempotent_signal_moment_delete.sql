begin;

create or replace function public.delete_my_signal_moment(
  p_moment_id uuid
)
returns text[]
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_state text;
  v_paths text[];
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select sm.state into v_state
  from public.signal_moments sm
  where sm.id=p_moment_id
    and sm.author_user_id=v_user_id
  for update;

  if not found then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;

  if v_state not in ('published','deleted') then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;

  select coalesce(
    array_agg(smm.storage_path order by smm.sort_order)
      filter (where smm.storage_path is not null),
    array[]::text[]
  )
  into v_paths
  from public.signal_moment_media smm
  where smm.moment_id=p_moment_id;

  if v_state='published' then
    update public.signal_moments
    set state='deleted',
        updated_at=clock_timestamp()
    where id=p_moment_id;
  end if;

  return v_paths;
end;
$function$;

alter function public.delete_my_signal_moment(uuid) owner to postgres;
revoke all on function public.delete_my_signal_moment(uuid) from public,anon;
grant execute on function public.delete_my_signal_moment(uuid) to authenticated;

comment on function public.delete_my_signal_moment(uuid)
is 'Idempotent owner-only Moment deletion. Retries after deletion return the same media paths for storage cleanup.';

commit;
