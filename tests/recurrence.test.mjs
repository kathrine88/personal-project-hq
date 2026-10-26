import test from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, weekTasks, taskKey } from '../js/recurrence.js';

const routine = { id:'00000000-0000-4000-8000-000000000001', task:'Read', project:'Other', frequency:'daily', weekdays:[], start_date:'2026-10-26', end_date:null, paused:false, deleted:false };
const week = (routines=[routine], exceptions=[], positions=[], ordinary=[], start='2026-10-26', end='2026-11-01') => weekTasks(ordinary,routines,exceptions,positions,start,end,'2026-10-28');

test('daily routines respect inclusive start/end dates without writing rows', () => {
  const limited={...routine,start_date:'2026-10-28',end_date:'2026-10-30'};
  assert.deepEqual(week([limited]).map(t=>t.scheduled_date),['2026-10-28','2026-10-29','2026-10-30']);
  const before=JSON.stringify(routine);
  for(let i=0;i<100;i++)assert.equal(week().length,7);
  assert.equal(JSON.stringify(routine),before);
  assert.equal(week([routine],[],[],[],'2035-05-07','2035-05-13').length,7);
});

test('weekly and fortnightly multi-weekday schedules anchor to start-date week', () => {
  const r={...routine,frequency:'weekly',weekdays:[1,3,7],start_date:'2026-10-28'};
  assert.deepEqual(week([r]).map(t=>t.scheduled_date),['2026-10-28','2026-11-01']);
  const f={...r,frequency:'fortnightly'};
  assert.equal(week([f],[],[],[],'2026-11-02','2026-11-08').length,0);
  assert.deepEqual(week([f],[],[],[],'2026-11-09','2026-11-15').map(t=>t.scheduled_date),['2026-11-09','2026-11-11','2026-11-15']);
});

test('monthly routines clamp at month-end, including leap years, then restore original day', () => {
  const r={...routine,frequency:'monthly',start_date:'2024-01-31'};
  for(const date of ['2024-02-29','2024-03-31','2025-02-28','2026-04-30'])assert.equal(occursOn(r,date),true,date);
  for(const date of ['2024-02-28','2024-03-30','2026-04-29'])assert.equal(occursOn(r,date),false,date);
});

test('individual completion, skip and cross-week moves are independent, unique and retained after edits', () => {
  const exception={routine_id:routine.id,occurrence_date:'2026-10-26',scheduled_date:'2026-11-02',completed:true,skipped:false,task:'Changed once',project:null};
  assert.equal(week([routine],[exception]).length,6);
  const future=week([routine],[exception],[],[],'2026-11-02','2026-11-08');
  assert.equal(future.length,8);
  assert.equal(future.filter(t=>t.completed).length,1);
  assert.equal(future.filter(t=>t.scheduled_date==='2026-11-02').length,2);
  assert.equal(new Set(future.map(taskKey)).size,future.length);
  assert.equal(week([{...routine,task:'New wording'}],[{...exception,scheduled_date:'2026-10-26'}])[0].task,'Changed once');
  assert.equal(week([routine],[{...exception,scheduled_date:'2026-10-26',skipped:true}]).filter(t=>t.skipped).length,1);
});

test('pausing preserves previous days and explicit exceptions; deleting keeps completed history only', () => {
  assert.equal(week([{...routine,paused:true}]).length,2);
  const changed={routine_id:routine.id,occurrence_date:'2026-10-30',scheduled_date:'2026-10-30',completed:false};
  assert.equal(week([{...routine,paused:true}],[changed]).length,3);
  assert.equal(week([{...routine,deleted:true}],[changed]).length,0);
  assert.equal(week([{...routine,deleted:true}],[{...changed,completed:true}]).length,1);
});

test('ordinary and recurring ordering is scoped to day and original occurrence identity', () => {
  const ordinary={id:5,task:'One-off',scheduled_date:'2026-10-26',completed:false};
  const positions=[{day:'2026-10-26',item_key:taskKey({...routine,routine_id:routine.id,occurrence_date:'2026-10-26'}),position:0},{day:'2026-10-26',item_key:'task:5',position:1}];
  const tasks=week([routine],[],positions,[ordinary]);
  assert.ok(tasks[0].routine_id);assert.equal(tasks[1].id,5);
  assert.equal(week([routine],[],positions,[ordinary],'2026-11-02','2026-11-08')[0].scheduled_date,'2026-11-02');
  assert.equal(positions.length,2);
});

test('absent planner bounds default safely; malformed bounds and missing routine dates are rejected', () => {
  const current = weekTasks([], [routine], [], []);
  assert.ok(Array.isArray(current));assert.ok(current.length <= 7);
  assert.deepEqual(weekTasks([], [routine], [], [], '', ''),[]);
  assert.deepEqual(week([{...routine,start_date:undefined}]),[]);
  assert.deepEqual(week([{...routine,start_date:null}]),[]);
  assert.equal(week([{...routine,end_date:undefined}]).length,7);
  assert.equal(week([{...routine,end_date:''}]).length,7);
  assert.equal(occursOn(routine,undefined),false);
});
