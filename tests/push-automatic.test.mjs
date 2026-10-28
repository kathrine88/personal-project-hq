import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {pushDatabase,fakeCron,ownerA,ownerB} from './push-db-fixture.mjs';
const options={skip:!process.env.PGLITE_MODULE};
test('scheduler upgrade and preparation are rerunnable, prepare no active job and reveal no secrets',options,async t=>{
 const {db,role,call,query}=await pushDatabase(t);
 await db.exec(fs.readFileSync(new URL('../docs/PUSH_AUTOMATIC_DELIVERY.sql',import.meta.url),'utf8'));
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'not_configured');
 await assert.rejects(call('hq_push_scheduler_start',[false]),e=>e.code==='42501');
 assert.equal((await query("select has_schema_privilege('authenticated','hq_push_private','USAGE') as allowed"))[0].allowed,false);
 await role('postgres');await fakeCron(db);
 // Fake extension APIs are local SQL only. Do NOT enable actual extensions/jobs.
 const prep=fs.readFileSync(new URL('../docs/PUSH_SCHEDULE_DISABLED.sql',import.meta.url),'utf8').replace(/^create extension.*$/gm,'');
 await db.exec(prep);await db.exec(prep);assert.equal((await query('select count(*)::int as n from cron.job'))[0].n,1);assert.equal((await query('select active from cron.job'))[0].active,false);
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'paused');
 await role('postgres');await query("select hq_push_private.invoke_scheduler()");
 const [request]=await query('select * from net.requests');assert.deepEqual(request.body,{action:'scheduled'});assert.equal(request.headers.Authorization,'Bearer '+'x'.repeat(43));assert.equal(request.timeout,55000);
 await role('anon');await assert.rejects(call('hq_push_scheduler_status'),e=>e.code==='42501');
});
test('active UI status requires configured Cron plus recent completed delivery tick; probe and stale/error states stay distinct',options,async t=>{
 const {db,query,role,call}=await pushDatabase(t);await fakeCron(db);
 await query("insert into cron.job(jobname,schedule,command) values('hq-reminder-push-minute','* * * * *','select hq_push_private.invoke_scheduler();')");
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'starting');
 await role('service_role');const [first,second]=await Promise.all([call('hq_push_scheduler_start',[false]),call('hq_push_scheduler_start',[false])]);assert.ok(first);assert.equal(second,null);
 assert.equal(await call('hq_push_scheduler_finish',[crypto.randomUUID(),true]),false);
 assert.equal(await call('hq_push_scheduler_finish',[first,true]),true);
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'probe');
 await role('service_role');const live=await call('hq_push_scheduler_start',[true]);await call('hq_push_scheduler_finish',[live,true]);
 await role('authenticated',ownerA);const health=await call('hq_push_scheduler_status');assert.equal(health.state,'active');assert.deepEqual(Object.keys(health).sort(),['lastCheckedAt','state']);
 await role('postgres');await query("update hq_push_private.scheduler_health set last_completed_at=now()-interval '4 minutes'");
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'stale');
 await role('postgres');await query('update hq_push_private.scheduler_health set last_completed_at=now(),last_ok=false');
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'error');
 await role('service_role');const abandoned=await call('hq_push_scheduler_start',[true]);await role('postgres');await query("update hq_push_private.scheduler_health set lease_until=now()-interval '1 second'");await role('service_role');const replacement=await call('hq_push_scheduler_start',[true]);assert.ok(replacement);assert.notEqual(abandoned,replacement);assert.equal(await call('hq_push_scheduler_finish',[abandoned,false]),false);assert.equal(await call('hq_push_scheduler_finish',[replacement,true]),true);
 await role('postgres');await query("update cron.job set command='select 1;'");
 await role('authenticated',ownerA);assert.equal((await call('hq_push_scheduler_status')).state,'not_configured');
});
test('due versus future/overdue, disabled devices, owner isolation, single-run enqueue and duplicate claims',options,async t=>{
 const f=await pushDatabase(t);const a1=await f.device(),a2=await f.device(),b=await f.device(ownerB);await f.device(ownerA,false);const newlyEnabled=await f.device();await f.query('update hq_push_private.devices set enabled_since=clock_timestamp() where id=$1',[newlyEnabled]);
 const due=await f.reminder(),other=await f.reminder({owner:ownerB});await f.reminder({minutes:10});await f.reminder({minutes:-16});
 await f.role('service_role');const claims=await f.call('hq_push_claim');assert.equal(claims.length,3);assert.equal((await f.call('hq_push_claim')).length,0);
 await f.role('postgres');const rows=await f.query('select occurrence_id,device_id from hq_push_private.deliveries');
 assert.deepEqual(rows.filter(r=>r.occurrence_id===due.occurrence.id).map(r=>r.device_id).sort(),[a1,a2].sort());assert.equal(rows.find(r=>r.occurrence_id===other.occurrence.id).device_id,b);
 await f.role('service_role');const [one,two]=await Promise.all([f.call('hq_push_begin',[claims[0].id,claims[0].token]),f.call('hq_push_begin',[claims[0].id,claims[0].token])]);assert.ok(one);assert.equal(two,null);
 await f.call('hq_push_finish',[claims[0].id,claims[0].token,201]);
 await f.role('postgres');assert.equal((await f.query('select status from public.hq_reminder_occurrences where id=$1',[due.occurrence.id]))[0].status,'pending');
});
test('edits, deletion, dismissal and completed linked tasks cancel queued delivery before send',options,async t=>{
 const f=await pushDatabase(t);await f.device();const edited=await f.reminder(),deleted=await f.reminder(),dismissed=await f.reminder();
 await f.role('authenticated',ownerA);await f.query("insert into public.test_tasks(id,owner_id,task,project) values(1,$1,'Linked','Garden')",[ownerA]);const linked=await f.reminder({link:{link_kind:'task',task_id:1}});
 await f.role('service_role');const claims=await f.call('hq_push_claim');assert.equal(claims.length,4);
 await f.role('authenticated',ownerA);let snap=await f.call('hq_reminder_snapshot');
 await f.call('hq_reminder_change',[deleted.id,snap.reminders.find(r=>r.id===deleted.id).version,'delete','{}']);
 await f.call('hq_reminder_change',[dismissed.id,snap.reminders.find(r=>r.id===dismissed.id).version,'dismiss',JSON.stringify({occurrence_id:dismissed.occurrence.id})]);
 await f.call('hq_reminder_change',[edited.id,snap.reminders.find(r=>r.id===edited.id).version,'save',JSON.stringify({link_kind:'standalone',title:'Edited',date:'2099-01-01',time:'09:00',timezone:'Europe/London'})]);
 await f.query('update public.test_tasks set completed=true where id=1');
 await f.role('service_role');for(const c of claims)assert.equal(await f.call('hq_push_begin',[c.id,c.token]),null);assert.equal((await f.call('hq_push_claim')).length,0);
});
test('repeat advances only on dismissal; SQL London schedules retain DST boundaries',options,async t=>{
 const f=await pushDatabase(t);await f.device();const repeated=await f.reminder({repeat:'daily'});
 await f.role('service_role');const [c]=await f.call('hq_push_claim');await f.call('hq_push_begin',[c.id,c.token]);await f.call('hq_push_finish',[c.id,c.token,201]);assert.equal((await f.call('hq_push_claim')).length,0);
 await f.role('authenticated',ownerA);let snap=await f.call('hq_reminder_snapshot');assert.equal(snap.occurrences.length,1);assert.equal(snap.occurrences[0].status,'pending');
 await f.call('hq_reminder_change',[repeated.id,snap.reminders[0].version,'dismiss',JSON.stringify({occurrence_id:repeated.occurrence.id})]);snap=await f.call('hq_reminder_snapshot');assert.equal(snap.occurrences.filter(o=>o.status==='pending').length,1);assert.ok(Date.parse(snap.occurrences.find(o=>o.status==='pending').due_at)>Date.now());
 const [dst]=await f.query("select ('2026-03-29 09:00'::timestamp at time zone 'Europe/London') as spring,('2026-10-25 09:00'::timestamp at time zone 'Europe/London') as autumn,('2026-03-29 01:30'::timestamp at time zone 'Europe/London') as gap,('2026-10-25 01:30'::timestamp at time zone 'Europe/London') as fold");
 assert.equal(dst.spring.toISOString(),'2026-03-29T08:00:00.000Z');assert.equal(dst.autumn.toISOString(),'2026-10-25T09:00:00.000Z');assert.equal(dst.gap.toISOString(),'2026-03-29T01:30:00.000Z');assert.equal(dst.fold.toISOString(),'2026-10-25T01:30:00.000Z');
});
test('bounded batches, bounded 429 retries, ambiguous failures and pre-send lease recovery',options,async t=>{
 const f=await pushDatabase(t);await f.device();for(let n=0;n<26;n++)await f.reminder();
 await f.role('service_role');const first=await f.call('hq_push_claim'),rest=await f.call('hq_push_claim');assert.equal(first.length,20);assert.equal(rest.length,6);assert.equal(new Set([...first,...rest].map(c=>c.id)).size,26);
 const rate=first[0];await f.call('hq_push_begin',[rate.id,rate.token]);await f.call('hq_push_finish',[rate.id,rate.token,429]);
 await f.role('postgres');assert.equal((await f.query('select state from hq_push_private.deliveries where id=$1',[rate.id]))[0].state,'retry');await f.query("update hq_push_private.deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[rate.id]);
 await f.role('service_role');let [again]=await f.call('hq_push_claim');for(let attempt=2;attempt<=3;attempt++){
  await f.call('hq_push_begin',[again.id,again.token]);await f.call('hq_push_finish',[again.id,again.token,429]);
  if(attempt<3){await f.role('postgres');await f.query("update hq_push_private.deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[rate.id]);await f.role('service_role');[again]=await f.call('hq_push_claim');}
 }
 await f.role('postgres');assert.equal((await f.query('select state from hq_push_private.deliveries where id=$1',[rate.id]))[0].state,'failed');
 await f.role('service_role');const unknown=first[1];await f.call('hq_push_begin',[unknown.id,unknown.token]);await f.call('hq_push_finish',[unknown.id,unknown.token,500]);
 const crash=first[3];await f.call('hq_push_begin',[crash.id,crash.token]);await f.role('postgres');await f.query("update hq_push_private.deliveries set claimed_at=now()-interval '3 minutes' where id=$1",[crash.id]);assert.equal((await f.query('select state from hq_push_private.deliveries where id=$1',[unknown.id]))[0].state,'unknown');await f.query("update hq_push_private.deliveries set claimed_at=now()-interval '3 minutes' where id=$1",[first[2].id]);
 await f.role('service_role');const [recovered]=await f.call('hq_push_claim');assert.equal(recovered.id,first[2].id);assert.notEqual(recovered.token,first[2].token);assert.equal(await f.call('hq_push_begin',[recovered.id,first[2].token]),null);await f.role('postgres');assert.equal((await f.query('select state from hq_push_private.deliveries where id=$1',[crash.id]))[0].state,'unknown');
});
