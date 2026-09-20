begin;
create or replace function public.get_my_pending_signal_completion_plan_id(p_session_started_at timestamptz)
returns uuid
language plpgsql stable security definer set search_path=public,pg_temp
as $function$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_session_started_at is null or p_session_started_at > clock_timestamp()+interval '5 minutes' then
    raise exception 'invalid_session_started_at' using errcode='22023';
  end if;
  return (
    select c.plan_id from public.plan_member_outing_completions c
    where c.user_id=v_user_id and c.feedback_at is null and c.completed_at>=p_session_started_at
    order by c.completed_at desc,c.plan_id limit 1
  );
end;$function$;
alter function public.get_my_pending_signal_completion_plan_id(timestamptz) owner to postgres;
revoke all on function public.get_my_pending_signal_completion_plan_id(timestamptz) from public,anon;
grant execute on function public.get_my_pending_signal_completion_plan_id(timestamptz) to authenticated;
drop function if exists public.get_my_pending_signal_completion_plan_id();
comment on function public.get_my_pending_signal_completion_plan_id(timestamptz) is 'Restores only unfinished DONE HERE feedback created during the caller current authenticated browser session, preventing historical unrated test/completed outings from hijacking a later login.';
commit;
