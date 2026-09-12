begin;

create or replace function public.can_upload_signal_moment_object(
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.plans p
    join public.plan_memberships pm on pm.plan_id=p.id
    where auth.uid() is not null
      and split_part(p_name,'/',1)=auth.uid()::text
      and split_part(p_name,'/',2)=p.id::text
      and p.state='completed'::public.plan_state
      and pm.user_id=auth.uid()
      and pm.membership_state='active'::public.plan_membership_state
      and not exists (
        select 1
        from public.signal_moments sm
        where sm.plan_id=p.id
          and sm.author_user_id=auth.uid()
          and sm.state <> 'deleted'
      )      and (
        select count(*)
        from storage.objects o
        where o.bucket_id='signal-moments'
          and split_part(o.name,'/',1)=auth.uid()::text
          and split_part(o.name,'/',2)=p.id::text
      ) < 6
  );
$$;

alter function public.can_upload_signal_moment_object(text) owner to postgres;
revoke all on function public.can_upload_signal_moment_object(text)
from public,anon;
grant execute on function public.can_upload_signal_moment_object(text)
to authenticated;

create or replace function public.can_delete_signal_moment_object(
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select auth.uid() is not null
    and split_part(p_name,'/',1)=auth.uid()::text
    and not exists (
      select 1
      from public.signal_moment_media smm
      join public.signal_moments sm on sm.id=smm.moment_id      where smm.storage_path=p_name
        and sm.state='published'
    );
$$;

alter function public.can_delete_signal_moment_object(text) owner to postgres;
revoke all on function public.can_delete_signal_moment_object(text)
from public,anon;
grant execute on function public.can_delete_signal_moment_object(text)
to authenticated;

drop policy if exists signal_moments_owner_delete on storage.objects;
create policy signal_moments_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id='signal-moments'
  and public.can_delete_signal_moment_object(name)
);

create or replace function public.validate_signal_moment_media_row()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_author_user_id uuid;
  v_plan_id uuid;
  v_storage_mime text;
begin  select sm.author_user_id,sm.plan_id
  into v_author_user_id,v_plan_id
  from public.signal_moments sm
  where sm.id=new.moment_id;

  if v_author_user_id is null then
    raise exception 'signal_moment_not_found' using errcode='P0001';
  end if;

  if split_part(new.storage_path,'/',1) <> v_author_user_id::text
     or split_part(new.storage_path,'/',2) <> v_plan_id::text then
    raise exception 'moment_media_path_not_owned' using errcode='42501';
  end if;

  select o.metadata->>'mimetype'
  into v_storage_mime
  from storage.objects o
  where o.bucket_id='signal-moments'
    and o.name=new.storage_path;

  if v_storage_mime is null then
    raise exception 'moment_media_object_missing' using errcode='P0001';
  end if;

  if new.mime_type <> v_storage_mime then
    raise exception 'moment_media_mime_mismatch' using errcode='22023';
  end if;

  if (new.media_kind='image' and new.mime_type not like 'image/%')
     or (new.media_kind='video' and new.mime_type not like 'video/%') then
    raise exception 'moment_media_kind_mismatch' using errcode='22023';
  end if;

  return new;
end;
$function$;alter function public.validate_signal_moment_media_row() owner to postgres;
revoke all on function public.validate_signal_moment_media_row()
from public,anon,authenticated;

drop trigger if exists signal_moment_media_validate on public.signal_moment_media;
create trigger signal_moment_media_validate
before insert or update of storage_path,media_kind,mime_type,moment_id
on public.signal_moment_media
for each row
execute function public.validate_signal_moment_media_row();

commit;
