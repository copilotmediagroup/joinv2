begin;

create or replace function public.accept_my_bored_opportunity(
  p_bored_intent_id uuid,
  p_activity_slug text
)
returns boolean
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare
  v_user uuid:=auth.uid();
  v_activity uuid;
  v_intent public.bored_open_intents%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_bored_intent_id is null then raise exception 'bored_intent_id_required' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|','bored_open_intent_user_v1',v_user::text),0
  ));

  select a.id into v_activity from public.activities a
  where a.slug=lower(btrim(p_activity_slug)) and a.is_active=true;
  if v_activity is null then raise exception 'active_activity_required' using errcode='P0001'; end if;  select boi.* into v_intent from public.bored_open_intents boi
  where boi.id=p_bored_intent_id and boi.user_id=v_user for update;
  if v_intent.id is null then raise exception 'bored_intent_not_found' using errcode='P0001'; end if;

  if v_intent.state='converted' and v_intent.chosen_activity_id=v_activity then
    return true;
  end if;
  if v_intent.state<>'open' or v_intent.expires_at<=clock_timestamp()
     or v_intent.chosen_activity_id is distinct from v_activity then
    raise exception 'bored_opportunity_not_active' using errcode='P0001';
  end if;

  update public.bored_open_intents
  set state='converted',updated_at=clock_timestamp()
  where id=v_intent.id;

  insert into public.bored_opportunity_events(
    bored_intent_id,user_id,activity_id,event_type
  ) values(v_intent.id,v_user,v_activity,'accepted');

  return true;
end;
$function$;

alter function public.accept_my_bored_opportunity(uuid,text) owner to postgres;
revoke all on function public.accept_my_bored_opportunity(uuid,text) from public,anon;
grant execute on function public.accept_my_bored_opportunity(uuid,text) to authenticated;
comment on function public.accept_my_bored_opportunity(uuid,text)
is 'Idempotently closes the caller open boredom intent after its automated activity has entered the authoritative Signal/Plan lifecycle.';

commit;
