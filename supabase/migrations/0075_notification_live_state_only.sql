begin;

create or replace function public.resolve_my_notification_target(p_notification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_notification public.notifications%rowtype;
  v_plan_id uuid;
  v_signal_group_id uuid;
  v_signal_intent_id uuid;
  v_group_state public.signal_group_state;
  v_activity_slug text;
  v_signal_stage text:='arrival';
  v_venue_round_id uuid;
  v_venue_winner_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;

  select n.* into v_notification
  from public.notifications n
  where n.id=p_notification_id and n.user_id=v_user_id;
  if not found then
    raise exception 'notification_not_found' using errcode='P0001';
  end if;
  v_plan_id:=v_notification.related_plan_id;
  if v_plan_id is null and v_notification.related_signal_group_id is not null then
    select p.id into v_plan_id
    from public.plans p
    where p.originating_signal_group_id=v_notification.related_signal_group_id
    limit 1;
  end if;

  if v_plan_id is not null and exists (
    select 1
    from public.plan_memberships pm
    join public.plans p on p.id=pm.plan_id
    where pm.plan_id=v_plan_id
      and pm.user_id=v_user_id
      and pm.membership_state='active'::public.plan_membership_state
      and p.state in (
        'published'::public.plan_state,
        'locked'::public.plan_state,
        'recovery_required'::public.plan_state,
        'active_outing'::public.plan_state
      )
  ) then
    return jsonb_build_object(
      'targetType','plan','planId',v_plan_id,
      'relatedEntityId',v_notification.related_entity_id
    );
  end if;

  v_signal_group_id:=v_notification.related_signal_group_id;
  select sgm.originating_signal_intent_id,sg.state,a.slug
  into v_signal_intent_id,v_group_state,v_activity_slug
  from public.signal_group_memberships sgm
  join public.signal_groups sg on sg.id=sgm.signal_group_id
  join public.signal_intents si on si.id=sgm.originating_signal_intent_id
  join public.activities a on a.id=sg.activity_id
  where sgm.signal_group_id=v_signal_group_id
    and sgm.user_id=v_user_id
    and sgm.state in ('matched','confirmed')
    and si.state='assigned'
    and sg.state in ('forming','confirming','locked','coordinating')
    and sg.expires_at>now()
    and not exists (
      select 1 from public.plans p
      where p.originating_signal_group_id=sg.id
    )
  order by sgm.created_at desc
  limit 1;

  if v_signal_intent_id is null then
    select sgm.signal_group_id,sgm.originating_signal_intent_id,sg.state,a.slug
    into v_signal_group_id,v_signal_intent_id,v_group_state,v_activity_slug
    from public.signal_group_memberships sgm
    join public.signal_groups sg on sg.id=sgm.signal_group_id
    join public.signal_intents si on si.id=sgm.originating_signal_intent_id
    join public.activities a on a.id=sg.activity_id
    where sgm.user_id=v_user_id
      and sgm.state in ('matched','confirmed')
      and si.state='assigned'
      and sg.state in ('forming','confirming','locked','coordinating')
      and sg.expires_at>now()
      and not exists (
        select 1 from public.plans p
        where p.originating_signal_group_id=sg.id
      )
    order by sgm.created_at desc
    limit 1;
  end if;

  if v_signal_intent_id is not null then
    select svr.id,svr.winner_option_id
    into v_venue_round_id,v_venue_winner_id
    from public.signal_venue_rounds svr
    where svr.signal_group_id=v_signal_group_id
    order by svr.round_number desc,svr.created_at desc
    limit 1;

    if v_venue_winner_id is not null then
      v_signal_stage:='time';
    elsif v_venue_round_id is not null then
      v_signal_stage:='places';
    else
      v_signal_stage:='arrival';
    end if;

    return jsonb_build_object(
      'targetType','signal',
      'signalGroupId',v_signal_group_id,
      'signalIntentId',v_signal_intent_id,
      'groupState',v_group_state,
      'activitySlug',v_activity_slug,
      'signalStage',v_signal_stage,
      'relatedEntityId',v_notification.related_entity_id
    );
  end if;

  return jsonb_build_object(
    'targetType','none',
    'reason','historical',
    'relatedEntityId',v_notification.related_entity_id
  );
end;
$function$;

alter function public.resolve_my_notification_target(uuid) owner to postgres;
revoke all on function public.resolve_my_notification_target(uuid) from public,anon;
grant execute on function public.resolve_my_notification_target(uuid) to authenticated;

comment on function public.resolve_my_notification_target(uuid)
is 'Notification links may open only the caller current operational Plan or live pre-Plan Signal. Historical alerts never resurrect live state.';

commit;
