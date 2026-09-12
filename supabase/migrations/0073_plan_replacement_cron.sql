begin;
do $do$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='signal-plan-replacement-reconcile' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule(
    'signal-plan-replacement-reconcile',
    '* * * * *',
    'select public.reconcile_expired_plan_replacements();'
  );
end
$do$;
commit;
