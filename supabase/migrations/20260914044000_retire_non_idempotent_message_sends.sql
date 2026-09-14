begin;

revoke execute on function public.send_plan_message(uuid,text) from authenticated;
revoke execute on function public.send_my_direct_message(uuid,text) from authenticated;

comment on function public.send_plan_message(uuid,text)
is 'Legacy non-idempotent send retained for migration history only; browser callers must use send_plan_message_v2 with a client message id.';

comment on function public.send_my_direct_message(uuid,text)
is 'Legacy non-idempotent send retained for migration history only; browser callers must use send_my_direct_message_v2 with a client message id.';

commit;
