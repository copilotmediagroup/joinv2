begin;

alter table public.user_reports
  add column if not exists client_report_id uuid;

create unique index if not exists user_reports_reporter_client_report_key
  on public.user_reports(reporter_user_id, client_report_id)
  where client_report_id is not null;

create or replace function public.report_user_v2(
  p_target_user_id uuid,
  p_reason text,
  p_details text default null,
  p_client_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_report_id uuid;
  v_details text:=nullif(btrim(p_details),'');
  v_existing public.user_reports%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_target_user_id is null or p_target_user_id=v_user_id then raise exception 'invalid_report_target' using errcode='22023'; end if;
  if p_client_report_id is null then raise exception 'client_report_id_required' using errcode='22023'; end if;
  if p_reason not in ('harassment','threats','hate','sexual','spam','impersonation','privacy','other') then raise exception 'invalid_report_reason' using errcode='22023'; end if;
  if v_details is not null and char_length(v_details)>2000 then raise exception 'report_details_too_long' using errcode='22023'; end if;
  if not exists(select 1 from public.user_profiles where user_id=p_target_user_id) then raise exception 'user_not_found' using errcode='P0001'; end if;

  select * into v_existing
  from public.user_reports
  where reporter_user_id=v_user_id
    and client_report_id=p_client_report_id;

  if found then
    if v_existing.reported_user_id<>p_target_user_id
      or v_existing.reason<>p_reason
      or v_existing.details is distinct from v_details then
      raise exception 'report_idempotency_key_conflict' using errcode='22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.user_reports(
    reporter_user_id,reported_user_id,reason,details,client_report_id
  ) values (
    v_user_id,p_target_user_id,p_reason,v_details,p_client_report_id
  )
  on conflict (reporter_user_id,client_report_id)
    where client_report_id is not null
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select ur.id into v_report_id
    from public.user_reports ur
    where ur.reporter_user_id=v_user_id
      and ur.client_report_id=p_client_report_id
      and ur.reported_user_id=p_target_user_id
      and ur.reason=p_reason
      and ur.details is not distinct from v_details;
    if v_report_id is null then raise exception 'report_idempotency_key_conflict' using errcode='22023'; end if;
  end if;

  return v_report_id;
end;
$function$;

alter function public.report_user_v2(uuid,text,text,uuid) owner to postgres;
revoke all on function public.report_user_v2(uuid,text,text,uuid) from public,anon;
grant execute on function public.report_user_v2(uuid,text,text,uuid) to authenticated;

comment on function public.report_user_v2(uuid,text,text,uuid)
is 'Creates one user report per client submission token. Reusing the same token with the same payload returns the original report; later reports use a new token.';

commit;
