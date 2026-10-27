-- OPTIONAL MANUAL SETUP, not a migration. Run ONLY after reviewing the PR,
-- applying the push migration, deploying/testing reminder-push and creating
-- Vault secret hq_push_dispatch_secret. This creates an INACTIVE job.
-- PUSH_DELIVERY_ENABLED must still be false in Edge Function Secrets.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if exists(select 1 from cron.job where jobname='hq-reminder-push-minute') then
  raise exception 'Job already exists. Inspect it instead of creating another.';
 end if;
 if (select count(*) from vault.decrypted_secrets where name='hq_push_dispatch_secret')<>1 then
  raise exception 'Create exactly one Vault secret named hq_push_dispatch_secret first.';
 end if;
end $$;
select cron.schedule('hq-reminder-push-minute','* * * * *', $job$
 select net.http_post(
  url:='https://rilqlmsojlplbaoxkztc.supabase.co/functions/v1/reminder-push',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
    (select decrypted_secret from vault.decrypted_secrets where name='hq_push_dispatch_secret')),
  body:='{"action":"dispatch"}'::jsonb,
  timeout_milliseconds:=55000
 );
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='hq-reminder-push-minute';
commit;
-- Verify WITHOUT displaying the command or any secret:
select jobid,jobname,schedule,active from cron.job where jobname='hq-reminder-push-minute';
