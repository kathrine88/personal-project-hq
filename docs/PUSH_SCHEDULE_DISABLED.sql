-- OPTIONAL MANUAL SETUP ONLY, after PUSH_AUTOMATIC_DELIVERY.sql + Edge update.
-- Keep PUSH_DELIVERY_ENABLED=false. Creates/updates ONE INACTIVE job, atomically.
-- Rerunning this preparation step intentionally pauses the existing job.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if to_regprocedure('hq_push_private.invoke_scheduler()') is null then
  raise exception 'Apply the Stage 3C-C SQL first.';
 end if;
 if exists(select 1 from cron.job where jobname='hq-reminder-push-minute' and username<>current_user) then
  raise exception 'Another role owns this job name. Inspect it before proceeding.';
 end if;
 if (select count(*) from vault.decrypted_secrets where name='hq_push_dispatch_secret')<>1 then
  raise exception 'Create exactly one Vault secret named hq_push_dispatch_secret first.';
 end if;
end $$;
select cron.schedule('hq-reminder-push-minute','* * * * *',
 'select hq_push_private.invoke_scheduler();');
select cron.alter_job(jobid,active:=false) from cron.job
 where jobname='hq-reminder-push-minute' and username=current_user;
commit;
select jobid,jobname,schedule,active from cron.job where jobname='hq-reminder-push-minute';
