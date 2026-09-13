begin;

create or replace function public.claim_next_moderation_report()
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_report_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  update public.user_reports
  set state='open',assigned_admin_user_id=null,claimed_at=null,updated_at=v_now
  where state='reviewing'
    and claimed_at < v_now-interval '30 minutes';

  with next_report as (
    select ur.id
    from public.user_reports ur
    where ur.state='open' and ur.assigned_admin_user_id is null
    order by ur.created_at,ur.id
    for update skip locked
    limit 1
  )
  update public.user_reports ur
  set state='reviewing',assigned_admin_user_id=v_user_id,
      claimed_at=v_now,updated_at=v_now
  from next_report nr
  where ur.id=nr.id
  returning ur.id into v_report_id;

  return v_report_id;
end;
$function$;

alter function public.claim_next_moderation_report() owner to postgres;
revoke all on function public.claim_next_moderation_report() from public,anon;
grant execute on function public.claim_next_moderation_report() to authenticated;

create or replace function public.claim_next_moderation_moment()
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
  v_report_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;

  update public.signal_moment_reports
  set state='open',assigned_admin_user_id=null,claimed_at=null,updated_at=v_now
  where state='reviewed'
    and claimed_at < v_now-interval '30 minutes';

  select smr.id into v_report_id
  from public.signal_moment_reports smr
  where smr.state='open'
    and smr.assigned_admin_user_id is null
  order by smr.created_at,smr.id
  for update skip locked
  limit 1;

  if v_report_id is null then
    return null;
  end if;

  update public.signal_moment_reports
  set state='reviewed',assigned_admin_user_id=v_admin_user_id,
      claimed_at=v_now,updated_at=v_now
  where id=v_report_id;

  return v_report_id;
end;
$function$;
alter function public.claim_next_moderation_moment() owner to postgres;
revoke all on function public.claim_next_moderation_moment() from public,anon;
grant execute on function public.claim_next_moderation_moment() to authenticated;

comment on function public.claim_next_moderation_report()
is 'Claims oldest user report and first recovers moderator claims abandoned for 30 minutes.';
comment on function public.claim_next_moderation_moment()
is 'Claims oldest Moment report and first recovers moderator claims abandoned for 30 minutes.';

commit;
