begin;

create or replace function public.purge_expired_signal_member_locations(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_deleted integer:=0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid_purge_limit' using errcode='22023';
  end if;

  with doomed as (
    select sml.signal_group_id,sml.user_id
    from public.signal_member_locations sml
    where sml.expires_at <= clock_timestamp()
    order by sml.expires_at,sml.signal_group_id,sml.user_id
    limit p_limit
    for update skip locked
  )
  delete from public.signal_member_locations sml
  using doomed d
  where sml.signal_group_id=d.signal_group_id
    and sml.user_id=d.user_id;

  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$function$;

alter function public.purge_expired_signal_member_locations(integer) owner to postgres;
revoke all on function public.purge_expired_signal_member_locations(integer)
from public,anon,authenticated;
grant execute on function public.purge_expired_signal_member_locations(integer)
to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='signal-location-purge';

select cron.schedule(
  'signal-location-purge',
  '*/5 * * * *',
  'select public.purge_expired_signal_member_locations(1000);'
);

comment on function public.purge_expired_signal_member_locations(integer)
is 'Internal bounded purge of expired private Signal member coordinates.';

commit;
