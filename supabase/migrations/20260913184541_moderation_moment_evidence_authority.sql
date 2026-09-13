create or replace function public.get_moderation_moment_evidence(
  p_report_id uuid
)
returns table(
  moment_id uuid,
  moment_state text,
  media jsonb
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_admin_user_id uuid:=auth.uid();
begin
  if v_admin_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if not public.has_admin_capability(v_admin_user_id,'moderation.review') then
    raise exception 'moderation_capability_required' using errcode='42501';
  end if;
  if p_report_id is null then
    raise exception 'invalid_moment_report' using errcode='22023';
  end if;

  return query
  select
    sm.id,
    sm.state,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'storagePath',smm.storage_path,
          'mediaKind',smm.media_kind,
          'mimeType',smm.mime_type,
          'sortOrder',smm.sort_order
        ) order by smm.sort_order
      ) filter (where smm.id is not null),
      '[]'::jsonb
    )
  from public.signal_moment_reports smr
  join public.signal_moments sm on sm.id=smr.moment_id
  left join public.signal_moment_media smm on smm.moment_id=sm.id
  where smr.id=p_report_id
  group by sm.id,sm.state;
end;
$function$;

alter function public.get_moderation_moment_evidence(uuid) owner to postgres;
revoke all on function public.get_moderation_moment_evidence(uuid) from public,anon;
grant execute on function public.get_moderation_moment_evidence(uuid) to authenticated;
create or replace function public.can_read_signal_moment_object(
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.signal_moment_media smm
      join public.signal_moments sm on sm.id=smm.moment_id
      where smm.storage_path=p_name
        and (
          sm.state='published'
          or (
            public.has_admin_capability(auth.uid(),'moderation.review')
            and exists (
              select 1
              from public.signal_moment_reports smr
              where smr.moment_id=sm.id
            )
          )
        )
    );
$$;
alter function public.can_read_signal_moment_object(text) owner to postgres;
revoke all on function public.can_read_signal_moment_object(text) from public,anon;
grant execute on function public.can_read_signal_moment_object(text) to authenticated;

comment on function public.get_moderation_moment_evidence(uuid)
is 'Capability-gated bounded evidence metadata for one reported Signal Moment.';

comment on function public.can_read_signal_moment_object(text)
is 'Allows authenticated reads for published Moment media and reported hidden media for moderation reviewers.';
