begin;
create or replace function public.get_my_pending_signal_completion_plan_id()
returns uuid
language sql stable security definer set search_path=public,pg_temp
as $function$
  select c.plan_id
  from public.plan_member_outing_completions c
  where c.user_id=auth.uid() and c.feedback_at is null
  order by c.completed_at desc,c.plan_id
  limit 1;
$function$;
alter function public.get_my_pending_signal_completion_plan_id() owner to postgres;
revoke all on function public.get_my_pending_signal_completion_plan_id() from public,anon;
grant execute on function public.get_my_pending_signal_completion_plan_id() to authenticated;
comment on function public.get_my_pending_signal_completion_plan_id() is 'Returns the caller latest DONE HERE completion whose private completion feedback has not yet been submitted, so the completion survey survives reload/deployment handoff.';
commit;
