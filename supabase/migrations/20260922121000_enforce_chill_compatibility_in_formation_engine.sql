begin;

-- The resolver filters Chill candidate groups, but the delegated formation
-- engine can independently select an exact-window group. Enforce the same
-- reciprocal dating predicate at the final authoritative admission point.
do $migration$
declare
  v_sql text;
  v_old text := $old$
    and public.is_my_signal_group_block_compatible(sg.id,p_user_id)
    and (select count(*) from public.signal_group_memberships capacity_membership where capacity_membership.signal_group_id=sg.id and capacity_membership.state in ('matched','confirmed')) < v_policy.max_capacity
$old$;
  v_new text := $new$
    and public.is_my_signal_group_block_compatible(sg.id,p_user_id)
    and (
      not exists (
        select 1 from public.activities chill_activity
        where chill_activity.id = p_activity_id
          and chill_activity.slug = 'chill'
      )
      or exists (
        select 1
        from public.signal_group_memberships chill_member
        where chill_member.signal_group_id = sg.id
          and chill_member.state in ('matched','confirmed')
          and public.chill_users_are_reciprocally_compatible(
            p_user_id,
            chill_member.user_id
          )
      )
    )
    and (select count(*) from public.signal_group_memberships capacity_membership where capacity_membership.signal_group_id=sg.id and capacity_membership.state in ('matched','confirmed')) < v_policy.max_capacity
$new$;
begin
  select pg_get_functiondef(
    'public.form_or_join_signal(uuid,uuid,uuid,timestamptz,timestamptz,public.crowd_mode,integer,integer,text,public.journey_origin,uuid,numeric)'::regprocedure
  ) into v_sql;

  if position(v_old in v_sql) = 0 then
    raise exception 'form_or_join_signal expected admission block not found';
  end if;

  execute replace(v_sql, v_old, v_new);
end
$migration$;

commit;
