import test from 'node:test';import assert from 'node:assert/strict';
import {reminderValues,reminderGroups,findReminder,zonedInstant,relativeReminder,relativeDue} from '../js/reminder-core.js';
import {createReminderRepository} from '../js/reminder-repository.js';
test('reminder validation requires an explicit civil date and time; linked reminders never repeat',()=>{
 const v={title:'Bins',date:'2026-11-05',time:'19:00',timezone:'Europe/London'};assert.equal(reminderValues(v).repeat_rule,'never');
 for(const patch of [{title:''},{date:undefined},{date:'2026-02-30'},{time:''},{time:'24:00'},{timezone:'Made/Up'},{notes:'a'.repeat(5001)}])assert.throws(()=>reminderValues({...v,...patch}));
 assert.throws(()=>reminderValues({...v,repeat_rule:'daily'},{link_kind:'task',task_id:7}));
 assert.equal(reminderValues({...v,title:''},{link_kind:'plan',plan_id:'id'}).link_kind,'plan');
});
test('attention persists after due time; history includes explicit cancellations; no duplicate task copies',()=>{
 const reminders=[{id:'r',link_kind:'task',task_id:7},{id:'s',link_kind:'standalone'}],occurrences=[{id:'a',reminder_id:'r',status:'pending',due_at:'2026-11-01T10:00Z'},{id:'b',reminder_id:'s',status:'pending',due_at:'2026-11-02T10:00Z'},{id:'c',reminder_id:'r',status:'dismissed',due_at:'2026-10-31T10:00Z',dismissed_at:'2026-11-01T11:00Z'}];
 let g=reminderGroups({reminders,occurrences},Date.parse('2026-11-01T12:00Z'));assert.deepEqual(g.attention.map(o=>o.id),['a']);assert.equal(g.history[0].id,'c');
 g=reminderGroups({reminders,occurrences},Date.parse('2027-11-01T12:00Z'));assert.deepEqual(g.attention.map(o=>o.id),['a','b']);assert.equal(findReminder({reminders},{link_kind:'task',task_id:7}),reminders[0]);
});
test('IANA civil times match documented DST rules and preserve wall-clock recurrence',()=>{
 assert.equal(new Date(zonedInstant('2026-03-29','01:30','Europe/London')).toISOString(),'2026-03-29T01:30:00.000Z');
 assert.equal(new Date(zonedInstant('2026-10-25','01:30','Europe/London')).toISOString(),'2026-10-25T01:30:00.000Z');
 assert.equal(new Date(zonedInstant('2026-07-01','09:00','Europe/London')).toISOString(),'2026-07-01T08:00:00.000Z');
 assert.equal(new Date(zonedInstant('2026-12-01','09:00','Europe/London')).toISOString(),'2026-12-01T09:00:00.000Z');
 assert.equal(new Date(zonedInstant('2026-11-01','01:30','America/New_York')).toISOString(),'2026-11-01T06:30:00.000Z');
});
test('relative event times use start date, actual hour offsets, and explicit clock for all-day dates',()=>{
 assert.deepEqual(relativeReminder({start_date:'2026-03-29',start_time:'02:30'},'hour','09:00','Europe/London'),{date:'2026-03-29',time:'00:30'});
 assert.deepEqual(relativeReminder({start_date:'2027-01-01'},'week','09:00','Europe/London'),{date:'2026-12-25',time:'09:00'});
 assert.equal(relativeReminder({start_date:'2026-11-01'},'hour','09:00','Europe/London'),null);
});
test('repository uses atomic version/occurrence RPC and isolates missing schema and uncertain results',async()=>{
 const calls=[],snapshot={reminders:[],occurrences:[]};const repo=createReminderRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:snapshot};}});
 await repo.change('id',3,'dismiss',{occurrence_id:'o'});assert.deepEqual(calls[0],{name:'hq_reminder_change',args:{p_id:'id',p_version:3,p_action:'dismiss',p_values:{occurrence_id:'o'}}});
 await assert.rejects(createReminderRepository({rpc:async()=>({error:{code:'PGRST202'}})}).load(),/Stage 3B/);
 await assert.rejects(createReminderRepository({rpc:async()=>({data:null})}).load(),/confirm/);
});

test('one hour before means elapsed hour, including the first repeated DST hour',()=>{assert.equal(new Date(relativeDue({start_date:'2026-11-01',start_time:'01:30'},'hour','09:00','America/New_York')).toISOString(),'2026-11-01T05:30:00.000Z');});
