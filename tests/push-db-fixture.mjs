// Minimal existing Stage 3B schema in isolated Postgres; no network/live credentials.
import fs from 'node:fs';
export const ownerA='10000000-0000-4000-8000-000000000001',ownerB='10000000-0000-4000-8000-000000000002';
export async function pushDatabase(t){
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=await PGlite.create();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('${ownerA}'),('${ownerB}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to public;
 create table public.test_tasks(id bigint primary key,owner_id uuid not null,task text,project text,scheduled_date date,completed boolean default false,unique(id,owner_id));
 create table public.hq_coming_up(id uuid primary key,owner_id uuid not null,task_id bigint,kind text,title text,start_date date,start_time time);
 create table public.hq_routines(id uuid primary key,owner_id uuid not null,task text,deleted boolean default false,unique(id,owner_id));
 create table public.hq_routine_occurrences(routine_id uuid,owner_id uuid,occurrence_date date,scheduled_date date,task text,completed boolean default false,skipped boolean default false);
 grant select,insert,update,delete on all tables in schema public to authenticated;`);
 for(const file of ['migrations/20261026200000_reminders.sql','migrations/20261026203000_web_push.sql','docs/PUSH_TEST_CLAIM_FIX.sql','docs/PUSH_AUTOMATIC_DELIVERY.sql'])await db.exec(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'));
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const role=async(name,owner='')=>db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role ${name};`);
 const call=async(name,args=[])=> (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args))[0].value;
 async function device(owner=ownerA,enabled=true){
  const id=crypto.randomUUID();await role('authenticated',owner);
  await call('hq_push_device',[id,'enable',JSON.stringify({endpoint:'https://web.push.apple.com/'+id,keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}}),'B'.repeat(87)]);
  if(!enabled)await call('hq_push_device',[id,'disable',null,null]);
  await role('postgres');await query("update hq_push_private.devices set enabled_since=now()-interval '1 day' where id=$1",[id]);return id;
 }
 async function reminder({owner=ownerA,minutes=-1,repeat='never',link={link_kind:'standalone'}}={}){
  await role('authenticated',owner);const [time]=await query("select to_char((now()+$1*interval '1 minute') at time zone 'Europe/London','YYYY-MM-DD') as date,to_char((now()+$1*interval '1 minute') at time zone 'Europe/London','HH24:MI:SS') as time",[minutes]);
  const id=crypto.randomUUID();const snapshot=await call('hq_reminder_change',[id,null,'save',JSON.stringify({...link,title:'Test',...time,timezone:'Europe/London',repeat_rule:repeat})]);
  return {id,occurrence:snapshot.occurrences.find(o=>o.reminder_id===id&&o.status==='pending')};
 }
 return {db,query,role,call,device,reminder};
}
export async function fakeCron(db){
 await db.exec(`create schema cron;create table cron.job(jobid bigint generated always as identity primary key,jobname text,username text default current_user,database text default current_database(),schedule text,command text,active boolean default true,unique(jobname,username));
 create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values('hq_push_dispatch_secret',repeat('x',43));
 create schema net;create table net.requests(body jsonb,headers jsonb,url text,timeout integer);
 create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 2000) returns bigint language plpgsql as $$begin insert into net.requests values(body,headers,url,timeout_milliseconds);return 1;end$$;`);
}
