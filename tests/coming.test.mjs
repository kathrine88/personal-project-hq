import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {comingValues,hydrateComing,comingGroups,monthGroups,eventsOn,timing,itemDate} from '../js/coming-core.js';
import {createComingRepository} from '../js/coming-repository.js';
const id='00000000-0000-4000-8000-000000000001';
const event=(patch={})=>({id,kind:'event',title:'A plan',notes:'',start_date:'2026-11-08',end_date:null,start_time:null,all_day:true,...patch});
test('events and to-dos validate optional dates/times, inclusive ranges, notes and explicit type',()=>{
 assert.deepEqual(comingValues({kind:'event',title:' Someday ',all_day:true}),{kind:'event',title:'Someday',notes:'',start_date:null,end_date:null,start_time:null,all_day:true});
 const todo=comingValues({kind:'todo',title:'Book a slot',start_date:'2026-11-08',start_time:'09:30'});assert.equal(todo.all_day,false);assert.equal(todo.start_time,'09:30');assert.equal(todo.end_date,null);
 const range=comingValues({kind:'event',title:'Holiday',start_date:'2026-11-09',end_date:'2026-11-13',all_day:true});assert.equal(range.end_date,'2026-11-13');
 for(const input of [{kind:'other',title:'x'},{kind:'event',title:''},{kind:'todo',title:'x'.repeat(501)},{kind:'event',title:'x',start_date:'2026-02-29'},{kind:'event',title:'x',start_date:'2026-11-10',end_date:'2026-11-09'},{kind:'event',title:'x',end_date:'2026-11-09'},{kind:'event',title:'x',start_date:'2026-11-09',all_day:false,start_time:'24:00'},{kind:'todo',title:'x',notes:'x'.repeat(5001)}])assert.throws(()=>comingValues(input));
});
test('Coming Up to-dos derive title/date/completion from the SAME existing personal task, never copied metadata',()=>{
 const metadata=[{id,kind:'todo',task_id:7,title:null,start_date:null,version:1}],tasks=[{id:7,project:null,task:'Review deals',scheduled_date:'2026-11-27',completed:false}];
 assert.equal(hydrateComing(metadata,tasks)[0].title,'Review deals');tasks[0].completed=true;tasks[0].scheduled_date='2026-11-28';tasks[0].task='Changed in the weekly planner';
 const item=hydrateComing(metadata,tasks)[0];assert.equal(item.completed,true);assert.equal(item.start_date,'2026-11-28');assert.equal(item.title,'Changed in the weekly planner');assert.equal(tasks.length,1);assert.equal(metadata[0].title,null);
 assert.deepEqual(hydrateComing(metadata,[{...tasks[0],project:'Garden'}]),[]);assert.deepEqual(hydrateComing(metadata,[]),[]);
});
test('today events stay all day regardless of start time, past final days go to history, incomplete overdue never vanish',()=>{
 const items=[event({id:'today',start_date:'2026-11-08',all_day:false,start_time:'00:01'}),event({id:'past',start_date:'2026-11-06',end_date:'2026-11-07'}),event({id:'ongoing',start_date:'2026-11-06',end_date:'2026-11-09'}),event({id:'overdue',kind:'todo',start_date:'2026-11-07',completed:false}),event({id:'done',kind:'todo',start_date:'2026-11-10',completed:true}),event({id:'idea',kind:'todo',start_date:null,completed:true})];
 const result=comingGroups(items,'2026-11-08');assert.deepEqual(result.upcoming.map(i=>i.id),['ongoing','today']);assert.deepEqual(result.overdue.map(i=>i.id),['overdue']);assert.deepEqual(result.someday.map(i=>i.id),['idea']);assert.ok(result.history.some(i=>i.id==='past'));assert.ok(result.history.some(i=>i.id==='done'));assert.equal(items.length,6);
 assert.equal(comingGroups(items,'2026-11-09').history.some(i=>i.id==='today'),true);assert.equal(comingGroups(items,'2026-11-09').upcoming.some(i=>i.id==='ongoing'),true);
});
test('multi-day events appear once on every inclusive day, never as checkable task duplicates',()=>{
 const holiday=event({start_date:'2026-11-09',end_date:'2026-11-13'}),rows=[holiday,event({id:'idea',start_date:null}),{id:'todo',kind:'todo',start_date:'2026-11-10'}];
 for(const day of ['09','10','11','12','13'])assert.deepEqual(eventsOn(rows,'2026-11-'+day),[holiday]);assert.deepEqual(eventsOn(rows,'2026-11-14'),[]);assert.deepEqual(eventsOn(rows,'2026-11-08'),[]);
 assert.equal(timing({...holiday,all_day:false,start_time:'09:00:00'},'2026-11-10'),'Continues');assert.equal(timing(holiday),'All day');assert.equal(rows.length,3);
});
test('month/year grouping handles ongoing ranges and year boundaries chronologically',()=>{
 const items=[event({id:'ongoing',start_date:'2026-10-30',end_date:'2026-11-02'}),event({id:'dec',start_date:'2026-12-31'}),event({id:'jan',start_date:'2027-01-01'})];
 const groups=monthGroups(comingGroups(items,'2026-11-01').upcoming,'2026-11-01');assert.deepEqual(groups.map(g=>g.key),['2026-11','2026-12','2027-01']);assert.equal(groups[0].label,'November 2026');
});
test('weekday/date formatting uses local calendar DATE values in far-east/west timezones and DST',()=>{
 const module=new URL('../js/coming-core.js',import.meta.url).href;
 for(const TZ of ['Europe/London','America/Los_Angeles','Pacific/Kiritimati']){
  const output=execFileSync(process.execPath,['--input-type=module','-e',`import {itemDate} from ${JSON.stringify(module)};console.log(itemDate({start_date:'2026-11-08'}));console.log(itemDate({start_date:'2026-03-29'}));`],{env:{...process.env,TZ},encoding:'utf8'});
  assert.match(output,/8 Nov 2026 · Sunday/);assert.match(output,/29 Mar 2026 · Sunday/);
 }
 assert.match(itemDate(event({start_date:'2026-12-31',end_date:'2027-01-02'})),/Thursday–Saturday/);
});
test('repository uses one authenticated atomic mutation, version checks and stable IDs; missing migration/conflicts are explicit',async()=>{
 const calls=[];let response={data:[]};const repo=createComingRepository({rpc:async(name,args)=>{calls.push({name,args});return response;}});
 await repo.load();assert.equal(calls[0].name,'hq_coming_snapshot');const values=comingValues({kind:'todo',title:'A task'});response={data:{entry:{id},entry_id:id,task:{id:7,project:null}}};await repo.save(id,2,values);assert.deepEqual(calls[1],{name:'hq_coming_change',args:{p_id:id,p_version:2,p_action:'save',p_values:values}});
 response={data:{entry_id:id}};await repo.remove(id,2);assert.equal(calls[2].args.p_action,'delete');response={error:{code:'40001'}};await assert.rejects(repo.save(id,2,values),/changed or deleted/);response={error:{code:'PGRST202'}};await assert.rejects(repo.load(),/Stage 3A/);response={data:null};await assert.rejects(repo.load(),/Could not read/);
});
