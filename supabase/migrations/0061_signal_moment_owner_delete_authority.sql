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
  v_paths text[];
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select coalesce(array_agg(smm.storage_path order by smm.sort_order),array[]::text[])
  into v_paths
  from public.signal_moments sm
  left join public.signal_moment_media smm on smm.moment_id=sm.id
  where sm.id=p_moment_id
    and sm.author_user_id=v_user_id
    and sm.state='published';

  if not found then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;
  update public.signal_moments
  set state='deleted',
      updated_at=clock_timestamp()
  where id=p_moment_id
    and author_user_id=v_user_id
    and state='published';

  if not found then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;

  return coalesce(v_paths,array[]::text[]);
end;
$function$;

alter function public.delete_my_signal_moment(uuid)
  owner to postgres;

revoke all on function public.delete_my_signal_moment(uuid)
from public,anon;

grant execute on function public.delete_my_signal_moment(uuid)
to authenticated;

comment on function public.delete_my_signal_moment(uuid)
is 'Marks auth.uid()''s published Signal Moment deleted and returns its private Storage paths so the authenticated client can remove the now-unpublished objects through Storage RLS.';

commit;
