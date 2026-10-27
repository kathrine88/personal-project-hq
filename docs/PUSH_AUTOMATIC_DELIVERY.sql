-- Stage 3C-C incremental Dashboard upgrade; rerunnable after Stage 3C-B + claim repair.
-- Does NOT install extensions, create/activate a job, send a push or change flags.
begin;
create or replace function public.hq_push_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- A crashed request after sending is ambiguous: NEVER replay it automatically.
 update hq_push_private.deliveries set state='unknown',finished_at=now() where state='sending' and claimed_at<now()-interval '2 minutes';
 insert into hq_push_private.deliveries(occurrence_id,device_id,next_attempt_at)
 select o.id,s.id,now() from public.hq_reminder_occurrences o join hq_push_private.devices s on s.owner_id=o.owner_id and s.enabled
 where o.status='pending' and o.due_at between greatest(s.enabled_since,now()-interval '15 minutes') and now()
  and hq_push_private.eligible(o.id,s.id)
  and not exists(select 1 from hq_push_private.deliveries d where d.occurrence_id=o.id and d.device_id=s.id)
 order by o.due_at,o.id,s.id limit 100 on conflict do nothing;
 with candidates as (
  select id from hq_push_private.deliveries
  where occurrence_id is not null and attempts<3 and
   ((state in ('ready','retry') and next_attempt_at<=now()) or (state='claimed' and claimed_at<now()-interval '2 minutes'))
  order by next_attempt_at,id for update skip locked limit 20
 ), claimed as (
  update hq_push_private.deliveries d set state='claimed',token=gen_random_uuid(),claimed_at=clock_timestamp()
  from candidates c where d.id=c.id returning d.id,d.token
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
 return result;
end $$;


create table if not exists hq_push_private.scheduler_health (
 singleton boolean primary key default true check(singleton),
 token uuid, lease_until timestamptz, current_mode text check(current_mode in ('probe','delivery')),
 last_started_at timestamptz, last_completed_at timestamptz,
 last_mode text check(last_mode in ('probe','delivery')), last_ok boolean
);
alter table hq_push_private.scheduler_health enable row level security;
alter table hq_push_private.scheduler_health force row level security;
revoke all on hq_push_private.scheduler_health from public,anon,authenticated,service_role;
insert into hq_push_private.scheduler_health(singleton) values(true) on conflict do nothing;

-- Global short lease avoids overlapping scheduled work; per-delivery one-use tokens
-- remain the definitive duplicate protection, including if this lease expires.
create or replace function public.hq_push_scheduler_start(p_delivery boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_token uuid;
begin
 if p_delivery is null then raise exception 'Missing scheduler mode.';end if;
 update hq_push_private.scheduler_health set token=gen_random_uuid(),
  lease_until=clock_timestamp()+interval '90 seconds',last_started_at=clock_timestamp(),
  current_mode=case when p_delivery then 'delivery' else 'probe' end
 where singleton and (lease_until is null or lease_until<=clock_timestamp()) returning token into v_token;
 return v_token;
end $$;
create or replace function public.hq_push_scheduler_finish(p_token uuid,p_ok boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or p_ok is null then return false;end if;
 update hq_push_private.scheduler_health set last_completed_at=clock_timestamp(),
  last_mode=current_mode,last_ok=p_ok,token=null,lease_until=null
 where singleton and token=p_token;
 return found;
end $$;

-- Safe app-wide operational metadata only. No delivery/subscription rows or cron
-- commands/secrets are returned. A flag or a manual dispatch alone cannot say active.
create or replace function public.hq_push_scheduler_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_jobs integer; v_active boolean; v_configured boolean;
 v_health hq_push_private.scheduler_health; v_state text;
begin
 if auth.uid() is null then raise exception 'Please sign in.' using errcode='42501';end if;
 if to_regclass('cron.job') is null then return jsonb_build_object('state','not_configured');end if;
 execute $job$
  select count(*)::integer,coalesce(bool_or(active),false),
   coalesce(bool_and(schedule='* * * * *' and btrim(command)='select hq_push_private.invoke_scheduler();' and username=current_user),false)
  from cron.job where jobname='hq-reminder-push-minute' and database=current_database()
 $job$ into v_jobs,v_active,v_configured;
 select * into v_health from hq_push_private.scheduler_health where singleton;
 if v_jobs<>1 or not v_configured then v_state:='not_configured';
 elsif not v_active then v_state:='paused';
 elsif v_health.last_completed_at is null then v_state:='starting';
 elsif v_health.last_completed_at<clock_timestamp()-interval '3 minutes' then v_state:='stale';
 elsif not coalesce(v_health.last_ok,false) then v_state:='error';
 elsif v_health.last_mode='probe' then v_state:='probe';
 else v_state:='active';end if;
 return jsonb_build_object('state',v_state,'lastCheckedAt',v_health.last_completed_at);
end $$;

-- Invoked only by the postgres-owned Cron job. Name/URL/action are fixed; Vault
-- supplies only the existing dedicated dispatch secret, never a service-role key.
create or replace function hq_push_private.invoke_scheduler() returns bigint
language plpgsql security invoker set search_path='' as $$
declare v_secret text;
begin
 if (select count(*) from vault.decrypted_secrets where name='hq_push_dispatch_secret')<>1 then
  raise exception 'Configure exactly one scheduler Vault secret.';
 end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='hq_push_dispatch_secret';
 if v_secret is null or length(v_secret)<32 then raise exception 'Scheduler Vault secret is invalid.';end if;
 return net.http_post(
  url:='https://rilqlmsojlplbaoxkztc.supabase.co/functions/v1/reminder-push',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
  body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=55000
 );
end $$;
revoke all on function hq_push_private.invoke_scheduler() from public,anon,authenticated,service_role;
revoke all on function public.hq_push_scheduler_start(boolean),public.hq_push_scheduler_finish(uuid,boolean),public.hq_push_scheduler_status() from public,anon,authenticated,service_role;
grant execute on function public.hq_push_scheduler_start(boolean),public.hq_push_scheduler_finish(uuid,boolean) to service_role;
grant execute on function public.hq_push_scheduler_status() to authenticated;
-- Reassert the existing claim boundary, including on reruns.
revoke all on function public.hq_push_claim() from public,anon,authenticated;
grant execute on function public.hq_push_claim() to service_role;
notify pgrst,'reload schema';
commit;
