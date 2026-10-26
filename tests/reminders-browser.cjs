// Persistent local fixtures only: no live Supabase writes or migration execution.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS||require('node:os').tmpdir();
const clientModule=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},rpc:(name,args)=>send({op:'rpc',name,args}),
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api},single:()=>{q.single=true;return api},gte:()=>api,lte:()=>api,eq:(k,v)=>{q.filters.push([k,v]);return api},insert:values=>{q.op='insert';q.values=values;return api},upsert:values=>{q.op='upsert';q.values=values;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const {zonedInstant,relativeReminder,relativeDue}=await import('../js/reminder-core.js');
 const owner='owner@example.com',idea='00000000-0000-4000-8000-000000000001',undatedTodo='00000000-0000-4000-8000-000000000002';let next=1001,missing=false,failBefore=false,failAfter=false,delayTasks=false,releaseTaskLoad=null;
 const entry=(id,patch)=>({id,owner_id:owner,kind:'event',title:'Plan',notes:'',start_date:null,end_date:null,start_time:null,all_day:true,task_id:null,version:1,...patch});
 const db={entries:[entry(idea,{title:'Try pottery'}),entry(undatedTodo,{kind:'todo',title:null,task_id:1000}),entry('00000000-0000-4000-8000-000000000003',{title:'Earlier event',start_date:'2026-11-05'}),entry('00000000-0000-4000-8000-000000000004',{title:'Today even after its time',start_date:'2026-11-08',all_day:false,start_time:'00:01:00'})],
 test_tasks:[{id:1,owner_id:owner,project:'Garden',task:'Ordinary garden task',completed:false,scheduled_date:'2026-11-09'},{id:1000,owner_id:owner,project:null,task:'Explore a course',completed:false,scheduled_date:null}],
 hq_routines:[{id:'00000000-0000-4000-8000-000000000099',owner_id:owner,project:'Other',task:'Daily routine',frequency:'daily',weekdays:[],start_date:'2026-11-09',end_date:null,paused:false,deleted:false}],hq_routine_occurrences:[],hq_task_positions:[],hq_meals:[],hq_shopping_items:[]};
 const reminders=[],occurrences=[];let reminderMissing=false;
 const snapshot=user=>({reminders:reminders.filter(r=>r.owner_id===user),occurrences:occurrences.filter(o=>o.owner_id===user)});
 const sourceInfo=r=>r.link_kind==='plan'?(()=>{const p=db.entries.find(p=>p.id===r.plan_id);if(!p)return null;const t=db.test_tasks.find(t=>t.id===p.task_id);return {...p,title:p.kind==='todo'?t.task:p.title,start_date:p.kind==='todo'?t.scheduled_date:p.start_date,resolved:t?.completed};})():r.link_kind==='task'?(()=>{const t=db.test_tasks.find(t=>t.id===r.task_id);return t?{title:t.task,start_date:t.scheduled_date,resolved:t.completed}:null;})():r.link_kind==='routine'?(()=>{const u=db.hq_routines.find(u=>u.id===r.routine_id),o=db.hq_routine_occurrences.find(o=>o.routine_id===r.routine_id&&o.occurrence_date===r.occurrence_date);return u?{title:o?.task||u.task,start_date:o?.scheduled_date||r.occurrence_date,resolved:o?.completed||o?.skipped}:null;})():{title:r.title};
 const pending=r=>occurrences.find(o=>o.reminder_id===r.id&&o.status==='pending');
 const cancel=(r,why)=>{const o=pending(r);if(o)Object.assign(o,{status:'cancelled',cancelled_at:'2026-11-08T20:00:00Z',resolution:why});};
 const append=(r,date=r.anchor_date)=>{r.sequence=(r.sequence||0)+1;r.version++;occurrences.push({id:'occ-'+next++,owner_id:r.owner_id,reminder_id:r.id,sequence:r.sequence,title:r.title,repeat_rule:r.repeat_rule,source_kind:r.link_kind==='standalone'?'standalone':sourceInfo(r)?.kind==='event'?'event':'task',due_at:new Date(r.timing&&r.timing!=='custom'?relativeDue(sourceInfo(r),r.timing,r.clock_time,r.timezone):zonedInstant(date,r.anchor_time,r.timezone)).toISOString(),due_date:date,due_time:r.anchor_time,timezone:r.timezone,status:'pending'});};
 const syncReminders=()=>{for(const r of reminders.filter(r=>!r.deleted_at&&r.link_kind!=='standalone')){const info=sourceInfo(r);r.version++;if(!info){cancel(r,'Linked item removed');r.deleted_at='2026-11-08T20:00:00Z';continue;}r.title=info.title;if(info.resolved){cancel(r,'Task completed or skipped');continue;}if(r.timing!=='custom'){const due=relativeReminder(info,r.timing,r.clock_time,r.timezone),o=pending(r);if(!due){cancel(r,'Linked date or time removed');continue;}if(o&&o.due_at!==new Date(zonedInstant(due.date,due.time,r.timezone)).toISOString()){cancel(r,'Rescheduled with linked item');r.anchor_date=due.date;r.anchor_time=due.time;append(r);}}const o=pending(r);if(o){o.title=r.title;o.source_kind=info.kind==='event'?'event':'task';}}};
 const touch=(task,previous=task.scheduled_date)=>{if(previous!==task.scheduled_date)db.hq_task_positions=db.hq_task_positions.filter(p=>!(p.owner_id===task.owner_id&&p.item_key==='task:'+task.id));const e=db.entries.find(e=>e.task_id===task.id&&e.owner_id===task.owner_id);if(e){e.version++;if(!task.scheduled_date){e.start_time=null;e.all_day=true;}}syncReminders();};
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.clock.install({time:new Date('2026-11-08T20:00:00Z')});
 await page.route('https://esm.sh/**',r=>r.fulfill({contentType:'application/javascript',body:clientModule}));
 await page.route('http://project.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname!=='/__db'){const file=pathname==='/'?'/index.html':pathname;return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html',body:fs.readFileSync(root+file)});}
  const q=JSON.parse(route.request().postData()),user=route.request().headers()['x-owner'],reply=(data,error=null)=>route.fulfill({json:{data,error}});
  if(q.op==='rpc'){
   if(q.name==='hq_reminder_snapshot')return reminderMissing?reply(null,{code:'PGRST202'}):reply(snapshot(user));
   if(q.name==='hq_reminder_change'){
    const {p_id:id,p_version:version,p_action:action,p_values:v}=q.args;let r=reminders.find(r=>r.id===id&&r.owner_id===user);
    if(r?r.version!==version:version!=null)return reply(null,{code:'40001'});
    if(failBefore){failBefore=false;return reply(null,{message:'Test reminder save failed'});}
    if(action==='save'){
     if(r){cancel(r,'Reminder edited');Object.assign(r,{title:v.title,notes:v.notes,timezone:v.timezone,repeat_rule:v.repeat_rule,timing:v.timing,anchor_date:v.date,anchor_time:v.time,clock_time:v.time});r.version++;}
     else{r={id,owner_id:user,version:1,...v,anchor_date:v.date,anchor_time:v.time,clock_time:v.time};reminders.push(r);}
     const info=sourceInfo(r);if(r.link_kind!=='standalone')r.title=info.title;
     if(v.timing!=='custom'){const due=relativeReminder(info,v.timing,v.time,v.timezone);r.anchor_date=due.date;r.anchor_time=due.time;}
     append(r);
    }else if(action==='dismiss'){
     const o=pending(r);assert.equal(o.id,v.occurrence_id);Object.assign(o,{status:'dismissed',dismissed_at:'2026-11-08T20:00:00Z'});r.version++;
     if(r.repeat_rule!=='never'){assert.equal(r.link_kind,'standalone');r.anchor_time=r.time;append(r,'2026-11-09');}
    }else if(action==='delete'){cancel(r,'Reminder removed');r.deleted_at='2026-11-08T20:00:00Z';r.version++;}
    if(failAfter){failAfter=false;return reply(null,{message:'Response interrupted'});}
    return reply(snapshot(user));
   }
   if(q.name==='hq_coming_snapshot')return missing?reply(null,{code:'PGRST202'}):reply(db.entries.filter(e=>e.owner_id===user));
   if(q.name==='hq_coming_change'){
    const {p_id:id,p_version:version,p_action:action,p_values:v}=q.args;
    if(failBefore){failBefore=false;return reply(null,{message:'Test save failed'});}
    let row=db.entries.find(e=>e.id===id&&e.owner_id===user);if(row?row.version!==version:version!=null)return reply(null,{code:'40001'});
    const old=row?.task_id??null;let task=null;
    const clearOld=()=>{db.test_tasks=db.test_tasks.filter(t=>!(t.id===old&&t.owner_id===user));db.hq_task_positions=db.hq_task_positions.filter(p=>!(p.owner_id===user&&p.item_key==='task:'+old));};
    if(action==='delete'){
     assert.ok(row);db.entries=db.entries.filter(e=>e!==row);if(old!=null)clearOld();syncReminders();return reply({entry_id:id,entry:null,task:null,removed_task_id:old});
    }
    assert.equal(action,'save');
    if(v.kind==='todo'){
     task=old!=null?db.test_tasks.find(t=>t.id===old&&t.owner_id===user):null;
     if(task){const previous=task.scheduled_date;task.task=v.title;task.scheduled_date=v.start_date;touch(task,previous);}
     else{task={id:next++,owner_id:user,project:null,task:v.title,scheduled_date:v.start_date,completed:false};db.test_tasks.push(task);}
    }
    const values={kind:v.kind,title:v.kind==='event'?v.title:null,notes:v.notes,start_date:v.kind==='event'?v.start_date:null,end_date:v.kind==='event'?v.end_date:null,start_time:v.start_time,all_day:v.all_day,task_id:task?.id??null};
    if(row)Object.assign(row,values,{version:row.version+1});else{row={id,owner_id:user,version:1,...values};db.entries.push(row);}
    if(old!=null&&old!==task?.id)clearOld();
    if(failAfter){failAfter=false;return reply(null,{message:'Response interrupted'});}
    syncReminders();return reply({entry_id:id,entry:row,task,removed_task_id:old!=null&&old!==task?.id?old:null});
   }
   if(q.name==='hq_move_task'){
    const {p_item_key:key,p_day:day,p_order:order}=q.args;assert.ok(key.startsWith('task:'));const task=db.test_tasks.find(t=>t.owner_id===user&&'task:'+t.id===key);const previous=task.scheduled_date;task.scheduled_date=day;touch(task,previous);
    db.hq_task_positions=db.hq_task_positions.filter(p=>p.owner_id!==user||(p.day!==day&&p.item_key!==key)).concat(order.map((item_key,position)=>({owner_id:user,day,item_key,position})));
    return reply({task,occurrence:null});
   }
   throw Error('Unexpected RPC '+q.name);
  }
  assert.ok(db[q.table],q.table);const matches=r=>r.owner_id===user&&q.filters.every(([k,v])=>r[k]===v);
  if(q.op==='list'){const rows=JSON.parse(JSON.stringify(db[q.table].filter(matches).slice(...(q.range?[q.range[0],q.range[1]+1]:[0]))));if(q.table==='test_tasks'&&delayTasks){delayTasks=false;await new Promise(resolve=>releaseTaskLoad=resolve);}return reply(rows);}
  if(q.op==='update'){
   const row=db[q.table].find(matches);if(!row)return reply(null,{message:'Missing record'});const previous=row.scheduled_date;Object.assign(row,q.values);if(q.table==='test_tasks')touch(row,previous);return reply(row);
  }
  if(q.op==='upsert'&&q.table==='hq_routine_occurrences'){let o=db[q.table].find(o=>o.routine_id===q.values.routine_id&&o.occurrence_date===q.values.occurrence_date&&o.owner_id===user);if(o)Object.assign(o,q.values);else{ o={owner_id:user,...q.values};db[q.table].push(o);}syncReminders();return reply(o);}
  if(q.op==='insert'&&q.table==='test_tasks'){const t={id:next++,owner_id:user,completed:false,...q.values};db.test_tasks.push(t);return reply(t);}
  throw Error('Unexpected operation');
 });
 const editor=page.locator('#reminderEditor'),field=n=>editor.locator('[name="'+n+'"]');
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#reminderAdd').disabled);
 const save=async()=>{await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#reminderEditor').open);};
 const go=async()=>{await page.locator('#remindersLink').click();await ready();};
 const edit=async title=>{await page.locator('#reminderActive .reminder-card').filter({has:page.locator('h3',{hasText:title})}).getByRole('button',{name:'Edit',exact:true}).click();await editor.waitFor({state:'visible'});};
 await page.goto('http://project.test/#reminders');await page.locator('#reminderSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();
 await page.locator('#reminderAdd').click();await field('title').fill('Put the bins out');await field('date').fill('2026-11-01');await field('time').fill('19:00');await field('repeat_rule').selectOption('daily');await field('notes').fill('Use the side gate.');await save();await ready();
 assert.equal(await page.locator('#reminderAttentionRows li').count(),1);const bins=reminders.find(r=>r.title==='Put the bins out'),first=pending(bins).id;assert.equal(occurrences.length,1);
 await page.reload();await ready();assert.equal(await page.locator('#reminderAttentionRows li').count(),1);assert.equal(pending(bins).id,first);
 await page.locator('#reminderAttentionRows').getByRole('button',{name:'Dismiss',exact:true}).click();await ready();assert.equal(await page.locator('#reminderAttentionRows li').count(),0);assert.equal(await page.locator('#reminderUpcomingRows li').count(),1);assert.equal(occurrences.filter(o=>o.status==='pending').length,1);
 await page.locator('[data-reminder-tab=history]').click();await page.waitForFunction(()=>!document.querySelector('#reminderHistory').hidden);assert.match(await page.locator('#reminderHistoryRows').innerText(),/Dismissed/);await page.locator('[data-reminder-tab=active]').click();await ready();
 await edit('Put the bins out');await field('repeat_rule').selectOption('never');await save();assert.equal(bins.repeat_rule,'never');assert.ok(occurrences.some(o=>o.id===first&&o.status==='dismissed'));
 // Save existing project task, then attach one reminder to exactly that task.
 await page.locator('#weekLink').click();await page.locator('#nextWeek').click();await page.getByRole('button',{name:'Edit Ordinary garden task',exact:true}).click();await page.locator('#taskEditor [data-set-reminder]').check();await page.locator('#taskEditor [type=submit]').click();await editor.waitFor({state:'visible'});
 assert.equal(await field('title').inputValue(),'Ordinary garden task');assert.equal(await field('title').getAttribute('readonly'),'');assert.equal(await editor.locator('[data-reminder-repeat]').isVisible(),false);assert.equal(await field('timing').locator('[value=hour]').isDisabled(),true);
 await field('timing').selectOption('day');await field('time').fill('09:00');await field('time').dispatchEvent('change');assert.equal(await field('date').inputValue(),'2026-11-08');await save();const tr=reminders.find(r=>r.task_id===1);assert.ok(tr);assert.equal(db.test_tasks.filter(t=>t.id===1).length,1);
 await page.getByRole('checkbox',{name:'Mark Ordinary garden task complete',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-task-id="1"]').classList.contains('done'));assert.equal(pending(tr),undefined);await page.getByRole('checkbox',{name:'Mark Ordinary garden task incomplete',exact:true}).click();assert.equal(pending(tr),undefined);
 // The same editor supports new ordinary tasks and one routine occurrence.
 await page.locator('[data-date="2026-11-10"] .day-add').click();await page.locator('#taskEditor [name=task]').fill('Book a haircut');await page.locator('#taskEditor [data-set-reminder]').check();await page.locator('#taskEditor [type=submit]').click();await editor.waitFor({state:'visible'});await field('date').fill('2026-11-09');await field('time').fill('11:00');await save();const haircut=db.test_tasks.find(t=>t.task==='Book a haircut');assert.ok(reminders.some(r=>r.task_id===haircut.id));
 await page.locator('[data-date="2026-11-09"]').getByRole('button',{name:'Edit Daily routine',exact:true}).click();await page.locator('#taskEditor [data-set-reminder]').check();await page.locator('#taskEditor [type=submit]').click();await editor.waitFor({state:'visible'});await field('date').fill('2026-11-09');await field('time').fill('08:00');await save();const rr=reminders.find(r=>r.link_kind==='routine');assert.equal(rr.occurrence_date,'2026-11-09');assert.equal(rr.repeat_rule,'never');assert.ok(!reminders.some(r=>r.occurrence_date==='2026-11-10'));
 await page.locator('[data-date="2026-11-09"]').getByRole('checkbox',{name:'Mark Daily routine complete',exact:true}).click();assert.equal(pending(rr),undefined);assert.ok(!db.hq_routine_occurrences.some(o=>o.occurrence_date==='2026-11-10'&&o.completed));
 // Coming Up event reminder created in its form; later date changes track relative times.
 await page.locator('#comingLink').click();await page.locator('#comingAdd').click();await page.locator('#comingEditor [name=title]').fill('Appointment');await page.locator('#comingEditor [name=start_date]').fill('2026-11-10');await page.locator('#comingEditor [name=all_day]').uncheck();await page.locator('#comingEditor [name=start_time]').fill('10:30');await page.locator('#comingEditor [data-set-reminder]').check();await page.locator('#comingEditor [type=submit]').click();await editor.waitFor({state:'visible'});
 await field('timing').selectOption('hour');assert.equal(await field('date').inputValue(),'2026-11-10');assert.equal(await field('time').inputValue(),'09:30');await save();const event=db.entries.find(p=>p.title==='Appointment'),er=reminders.find(r=>r.plan_id===event.id);assert.ok(er);assert.equal(pending(er).due_at,'2026-11-10T09:30:00.000Z');
 await page.getByRole('button',{name:'Edit plan Appointment',exact:true}).click();await page.locator('#comingEditor [name=start_date]').fill('2026-11-12');await page.locator('#comingEditor [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#comingEditor').open);assert.equal(pending(er).due_date,'2026-11-12');
 await go();await edit('Appointment');await field('timing').selectOption('custom');await field('date').fill('2026-11-09');await field('time').fill('16:00');await save();const absolute=pending(er).due_at;
 await page.locator('#comingLink').click();await page.getByRole('button',{name:'Edit plan Appointment',exact:true}).click();await page.locator('#comingEditor [name=start_date]').fill('2026-11-13');await page.locator('#comingEditor [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#comingEditor').open);assert.equal(pending(er).due_at,absolute);
 // Converting keeps the plan association. Completing the shared task resolves it.
 await page.getByRole('button',{name:'Edit plan Appointment',exact:true}).click();await page.locator('#comingEditor [name=kind]').selectOption('todo');await page.locator('#comingEditor [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#comingEditor').open);assert.equal(er.plan_id,event.id);assert.equal(pending(er).source_kind,'task');assert.equal(db.test_tasks.filter(t=>t.id===event.task_id).length,1);
 await page.getByRole('checkbox',{name:'Mark Appointment complete',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-plan-id] .is-complete')||document.querySelector('#comingStatus').textContent==='Saved.');assert.equal(pending(er),undefined);
 // Reopen then explicitly set a new reminder; deleting its plan cancels it, keeping history.
 await page.locator('[data-coming-tab=history]').click();await page.getByRole('checkbox',{name:'Mark Appointment incomplete',exact:true}).click();await page.locator('[data-coming-tab=upcoming]').click();await page.getByRole('button',{name:'Edit plan Appointment',exact:true}).click();await page.locator('#comingEditor [name=kind]').selectOption('event');await page.locator('#comingEditor [data-set-reminder]').check();await page.locator('#comingEditor [type=submit]').click();await editor.waitFor({state:'visible'});await field('date').fill('2026-11-12');await field('time').fill('14:00');await save();assert.ok(pending(er));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete plan Appointment',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#comingStatus').textContent==='Saved.');assert.equal(pending(er),undefined);assert.ok(er.deleted_at);assert.ok(occurrences.some(o=>o.reminder_id===er.id&&o.status==='cancelled'));
 // Direct creation is standalone: never appears in Coming Up or weekly tasks.
 await go();await page.locator('#reminderAdd').click();await field('title').fill('Collect parcel');await field('date').fill('2026-11-09');await field('time').fill('12:00');await save();assert.ok(!db.test_tasks.some(t=>t.task==='Collect parcel'));assert.ok(!db.entries.some(p=>p.title==='Collect parcel'));
 await edit('Collect parcel');await field('title').fill('Edited parcel');failAfter=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#reminderEditor [role=alert]').textContent.includes('Response interrupted'));assert.equal(await field('title').inputValue(),'Edited parcel');assert.equal(await editor.locator('[type=submit]').isDisabled(),true);assert.equal(reminders.filter(r=>r.title==='Edited parcel').length,1);await editor.locator('[data-cancel]').click();await page.locator('#reminderReload').click();await ready();
 await edit('Edited parcel');reminders.find(r=>r.title==='Edited parcel').version++;await field('title').fill('Stale parcel');await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#reminderEditor [role=alert]').textContent.includes('changed'));assert.ok(!reminders.some(r=>r.title==='Stale parcel'));await editor.locator('[data-cancel]').click();await page.locator('#reminderReload').click();await ready();
 page.once('dialog',d=>d.dismiss());await page.locator('#reminderActive .reminder-card').filter({has:page.locator('h3',{hasText:'Edited parcel'})}).getByRole('button',{name:'Delete',exact:true}).click();assert.ok(!reminders.find(r=>r.title==='Edited parcel').deleted_at);
 page.once('dialog',d=>d.accept());await page.locator('#reminderActive .reminder-card').filter({has:page.locator('h3',{hasText:'Edited parcel'})}).getByRole('button',{name:'Delete',exact:true}).click();await ready();assert.ok(reminders.find(r=>r.title==='Edited parcel').deleted_at);assert.ok(occurrences.some(o=>o.reminder_id===bins.id&&o.status==='dismissed'));
 for(const width of [320,375,390,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'hq-reminders.png'),fullPage:true});
 await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#reminderSignIn').hidden);assert.equal(await page.locator('#remindersView .reminder-card').count(),0);await page.locator('#reminderSignIn').click();await page.locator('#email').fill('second@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await page.locator('#remindersView .reminder-card').count(),0);
 await page.locator('#logout').click();await page.locator('#reminderSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.ok(await page.locator('#reminderUpcomingRows li').count());
 reminderMissing=true;await page.locator('#reminderReload').click();await page.waitForFunction(()=>document.querySelector('#reminderError').textContent.includes('Stage 3B'));await page.locator('#weekLink').click();await page.locator('#nextWeek').click();assert.ok(await page.locator('.week-task').count());assert.deepEqual(errors,[]);
 console.log('PASS Reminders: overdue persistence, dismissal/next recurrence/history, stopping repeat, standalone isolation, task/event links without copies, completion/reopen, relative/absolute timing, conversion, uncertain saves/conflicts, confirmation, sessions, missing schema and mobile layout. Supabase mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
