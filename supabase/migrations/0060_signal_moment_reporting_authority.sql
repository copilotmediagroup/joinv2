begin;

create table if not exists public.signal_moment_reports (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.signal_moments(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  details text null,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signal_moment_reports_reason_check
    check (reason in ('spam','harassment','hate','nudity','violence','privacy','other')),
  constraint signal_moment_reports_state_check
    check (state in ('open','reviewed','dismissed','actioned')),
  constraint signal_moment_reports_details_check
    check (details is null or char_length(details) <= 500),
  constraint signal_moment_reports_one_per_user
    unique (moment_id, reporter_user_id)
);

create index if not exists signal_moment_reports_open_idx
  on public.signal_moment_reports(state,created_at,id);

alter table public.signal_moment_reports enable row level security;
revoke all on table public.signal_moment_reports
from public,anon,authenticated;

grant select on table public.signal_moment_reports
to service_role;

create or replace function public.report_signal_moment(
  p_moment_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_report_id uuid;
  v_author_user_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  if p_reason not in ('spam','harassment','hate','nudity','violence','privacy','other') then
    raise exception 'invalid_report_reason' using errcode='22023';
  end if;
  if p_details is not null and char_length(trim(p_details)) > 500 then
    raise exception 'report_details_too_long' using errcode='22023';
  end if;

  select sm.author_user_id
  into v_author_user_id
  from public.signal_moments sm
  where sm.id=p_moment_id
    and sm.state='published';

  if v_author_user_id is null then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;

  if v_author_user_id=v_user_id then
    raise exception 'cannot_report_own_moment' using errcode='22023';
  end if;

  insert into public.signal_moment_reports(
    moment_id,reporter_user_id,reason,details,state
  ) values (
    p_moment_id,v_user_id,p_reason,nullif(trim(p_details),''),'open'
  )
  on conflict (moment_id,reporter_user_id)
  do update set
    reason=excluded.reason,
    details=excluded.details,
    state='open',
    updated_at=clock_timestamp()
  returning id into v_report_id;
  return v_report_id;
end;
$function$;

alter function public.report_signal_moment(uuid,text,text)
  owner to postgres;

revoke all on function public.report_signal_moment(uuid,text,text)
from public,anon;

grant execute on function public.report_signal_moment(uuid,text,text)
to authenticated;

comment on function public.report_signal_moment(uuid,text,text)
is 'Lets an authenticated user report a published Signal Moment without direct table access. Duplicate reports by the same user are updated idempotently.';

commit;
