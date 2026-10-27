// Isolated Postgres test. Install @electric-sql/pglite@0.3.14 locally, then set
// PGLITE_MODULE to its ESM entry file URL. Never runs against the live database.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const uid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',device='20000000-0000-4000-8000-000000000001',reminder='30000000-0000-4000-8000-000000000001';
test('real Postgres: migration, ownership/grants, deduplication, cancellation, retries and preserved Stage 3B recurrence',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=await PGlite.create();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('${uid}'),('${other}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to public;
 create table public.test_tasks(id bigint primary key,owner_id uuid not null,task text,project text,scheduled_date date,completed boolean default false,unique(id,owner_id));
 create table public.hq_coming_up(id uuid primary key,owner_id uuid not null,task_id bigint,kind text,title text,start_date date,start_time time);
 create table public.hq_routines(id uuid primary key,owner_id uuid not null,task text,deleted boolean default false,unique(id,owner_id));
 create table public.hq_routine_occurrences(routine_id uuid,owner_id uuid,occurrence_date date,scheduled_date date,task text,completed boolean default false,skipped boolean default false);
 grant select,insert,update,delete on all tables in schema public to authenticated;`);
 await db.exec(fs.readFileSync(new URL('../migrations/20261026200000_reminders.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../migrations/20261026203000_web_push.sql',import.meta.url),'utf8'));
 const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const role=async(name,user='')=>{await db.exec(`reset role;set request.jwt.claim.sub='${user}';set role ${name};`);};
 const call=async(name,args=[])=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await query(`select public.${name}(${placeholders}) as value`,args))[0].value;};
 const sub={endpoint:'https://web.push.apple.com/example',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}};
 await role('authenticated',uid);await call('hq_push_device',[device,'enable',JSON.stringify(sub),'B'.repeat(87)]);
 // Reproduce the production bug in the ORIGINAL migration, then test the repair.
 await assert.rejects(call('hq_push_test_claim',[device]),error=>error.code==='42702'&&error.message.includes('d.device_id'));
 await role('postgres');assert.equal((await query('select count(*)::int as count from hq_push_private.deliveries'))[0].count,0);
 await db.exec(fs.readFileSync(new URL('../docs/PUSH_TEST_CLAIM_FIX.sql',import.meta.url),'utf8'));
 await role('authenticated',uid);
 const claimProof=await call('hq_push_test_claim',[device]);assert.ok(claimProof.id);assert.ok(claimProof.token);
 assert.equal((await query("select has_schema_privilege('authenticated','hq_push_private','USAGE') as allowed"))[0].allowed,false);
 await assert.rejects(call('hq_push_begin',[claimProof.id,claimProof.token]),error=>error.code==='42501');
 await assert.rejects(call('hq_push_finish',[claimProof.id,claimProof.token,201]),error=>error.code==='42501');
 await assert.rejects(call('hq_push_test_claim',[device]),error=>error.code==='PT429');
 await role('authenticated',other);await assert.rejects(call('hq_push_test_claim',[device]),error=>error.code==='PT409');
 await role('postgres');await query('delete from hq_push_private.deliveries where id=$1',[claimProof.id]);await role('authenticated',uid);

 await role('authenticated',other);assert.equal(await call('hq_push_device',[device,'status',null,null]),null);
 await assert.rejects(call('hq_push_device',[device,'enable',JSON.stringify(sub),'B'.repeat(87)]));
 await assert.rejects(call('hq_push_claim'));await assert.rejects(query('select * from hq_push_private.devices'));
 await role('anon');await assert.rejects(call('hq_push_test_claim',[device]),error=>error.code==='42501');await assert.rejects(call('hq_push_device',[device,'status',null,null]));
 await role('authenticated',uid);
 const day=(await query("select to_char((now()-interval '1 minute') at time zone 'Europe/London','YYYY-MM-DD') as day,to_char((now()-interval '1 minute') at time zone 'Europe/London','HH24:MI:SS') as time"))[0];
 await call('hq_reminder_change',[reminder,null,'save',JSON.stringify({link_kind:'standalone',title:'Private reminder',notes:'Private notes',date:day.day,time:day.time,timezone:'Europe/London',repeat_rule:'daily'})]);
 await role('postgres');await db.exec("update hq_push_private.devices set enabled_since=now()-interval '1 hour'");
 await role('service_role');let claims=await call('hq_push_claim');assert.equal(claims.length,1);assert.equal((await call('hq_push_claim')).length,0);
 const claim=claims[0];let send=await call('hq_push_begin',[claim.id,claim.token]);assert.ok(send.subscription);assert.equal(await call('hq_push_begin',[claim.id,claim.token]),null);
 await call('hq_push_finish',[claim.id,claim.token,201]);assert.equal((await call('hq_push_claim')).length,0);
 await role('postgres');assert.equal((await query('select status from public.hq_reminder_occurrences'))[0].status,'pending');
 await role('authenticated',uid);let snapshot=await call('hq_reminder_snapshot');await call('hq_reminder_change',[reminder,snapshot.reminders[0].version,'dismiss',JSON.stringify({occurrence_id:snapshot.occurrences[0].id})]);
 snapshot=await call('hq_reminder_snapshot');assert.equal(snapshot.occurrences.filter(o=>o.status==='pending').length,1);assert.ok(Date.parse(snapshot.occurrences.find(o=>o.status==='pending').due_at)>Date.now());
 // A new overdue occurrence can be claimed, then cancelled before send.
 const another='30000000-0000-4000-8000-000000000002';await call('hq_reminder_change',[another,null,'save',JSON.stringify({link_kind:'standalone',title:'Cancel me',date:day.day,time:day.time,timezone:'Europe/London'})]);
 await role('service_role');claims=await call('hq_push_claim');assert.equal(claims.length,1);
 await role('authenticated',uid);snapshot=await call('hq_reminder_snapshot');await call('hq_reminder_change',[another,snapshot.reminders.find(r=>r.id===another).version,'delete','{}']);
 await role('service_role');assert.equal(await call('hq_push_begin',[claims[0].id,claims[0].token]),null);
 // Test rate limiting is account-wide, not caller-clock controlled.
 await role('authenticated',uid);const testClaim=await call('hq_push_test_claim',[device]);await assert.rejects(call('hq_push_test_claim',[device]));
 await role('service_role');await call('hq_push_begin',[testClaim.id,testClaim.token]);await call('hq_push_finish',[testClaim.id,testClaim.token,410]);
 await role('authenticated',uid);assert.equal((await call('hq_push_device',[device,'status',null,null])).enabled,false);
 // Test the retry state machine with a fresh ledger row; no reminder-state writes.
 await role('postgres');await db.exec("update hq_push_private.devices set enabled=true,subscription='"+JSON.stringify(sub)+"'::jsonb,enabled_since=now()-interval '1 hour';");
 const retry='30000000-0000-4000-8000-000000000003';await role('authenticated',uid);await call('hq_reminder_change',[retry,null,'save',JSON.stringify({link_kind:'standalone',title:'Rate limited',date:day.day,time:day.time,timezone:'Europe/London'})]);
 for(let attempt=1;attempt<=3;attempt++){
  await role('service_role');const [c]=await call('hq_push_claim');assert.ok(c);await call('hq_push_begin',[c.id,c.token]);await call('hq_push_finish',[c.id,c.token,429]);
  await role('postgres');const [row]=await query('select state,attempts from hq_push_private.deliveries where id=$1',[c.id]);assert.equal(row.attempts,attempt);assert.equal(row.state,attempt<3?'retry':'failed');await query('update hq_push_private.deliveries set next_attempt_at=now()-interval \'1 second\' where id=$1',[c.id]);
 }
 await role('service_role');assert.equal((await call('hq_push_claim')).length,0);
 }finally{await db.close();}
});
