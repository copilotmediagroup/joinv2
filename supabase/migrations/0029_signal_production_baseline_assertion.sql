begin;

-- SIGNAL production baseline assertion.
-- Records the verified post-0028 baseline without re-running
-- historical manual migrations in production.
do $$
declare
  v_form text;
  v_confirm text;
  v_withdraw text;
begin
  v_form := pg_get_functiondef('public.form_or_join_signal(uuid,uuid,uuid,timestamptz,timestamptz,public.crowd_mode,integer,integer,text,public.journey_origin,uuid,numeric)'::regprocedure);
  v_confirm := pg_get_functiondef('public.confirm_my_signal_membership(uuid)'::regprocedure);
  v_withdraw := pg_get_functiondef('public.withdraw_my_signal(uuid)'::regprocedure);

  if position('update public.signal_group_memberships as sgm' in lower(v_form)) = 0 then
    raise exception 'baseline_missing_threshold_alias_repair';
  end if;

  if position('and sg.state = ''forming''::public.signal_group_state' in lower(v_form)) = 0 then
    raise exception 'baseline_missing_forming_only_admission';
  end if;

  if position('canonical confirmation lock order' in lower(v_confirm)) = 0 then
    raise exception 'baseline_missing_canonical_confirmation_lock_order';
  end if;

  if position('signal_already_converted_to_plan' in lower(v_withdraw)) = 0 then
    raise exception 'baseline_missing_locked_withdrawal_plan_guard';
  end if;
end;
$$;

commit;
