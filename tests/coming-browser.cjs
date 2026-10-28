// Persistent local fixtures only: no live Supabase writes or migration execution.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS||require('node:os').tmpdir();
const clientModule=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},rpc:(name,args)=>send({op:'rpc',name,args}),
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api},single:()=>{q.single=true;return api},gte:()=>api,lte:()=>api,eq:(k,v)=>{q.filters.push([k,v]);return api},insert:values=>{q.op='insert';q.values=values;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const owner='owner@example.com',idea='00000000-0000-4000-8000-000000000001',undatedTodo='00000000-0000-4000-8000-000000000002';let next=1001,missing=false,failBefore=false,failAfter=false,delayTasks=false,releaseTaskLoad=null;
 const entry=(id,patch)=>({id,owner_id:owner,kind:'event',title:'Plan',notes:'',start_date:null,end_date:null,start_time:null,all_day:true,task_id:null,version:1,...patch});
 const db={entries:[entry(idea,{title:'Try pottery'}),entry(undatedTodo,{kind:'todo',title:null,task_id:1000}),entry('00000000-0000-4000-8000-000000000003',{title:'Earlier event',start_date:'2026-11-05'}),entry('00000000-0000-4000-8000-000000000004',{title:'Today even after its time',start_date:'2026-11-08',all_day:false,start_time:'00:01:00'})],
 test_tasks:[{id:1,owner_id:owner,project:'Garden',task:'Ordinary garden task',completed:false,scheduled_date:'2026-11-09'},{id:1000,owner_id:owner,project:null,task:'Explore a course',completed:false,scheduled_date:null}],
 hq_routines:[{id:'00000000-0000-4000-8000-000000000099',owner_id:owner,project:'Other',task:'Daily routine',frequency:'daily',weekdays:[],start_date:'2026-11-09',end_date:null,paused:false,deleted:false}],hq_routine_occurrences:[],hq_task_positions:[],hq_meals:[],hq_shopping_items:[]};
 const touch=(task,previous=task.scheduled_date)=>{if(previous!==task.scheduled_date)db.hq_task_positions=db.hq_task_positions.filter(p=>!(p.owner_id===task.owner_id&&p.item_key==='task:'+task.id));const e=db.entries.find(e=>e.task_id===task.id&&e.owner_id===task.owner_id);if(e){e.version++;if(!task.scheduled_date){e.start_time=null;e.all_day=true;}}};
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
   if(q.name==='hq_coming_snapshot')return missing?reply(null,{code:'PGRST202'}):reply(db.entries.filter(e=>e.owner_id===user));
   if(q.name==='hq_coming_change'){
    const {p_id:id,p_version:version,p_action:action,p_values:v}=q.args;
    if(failBefore){failBefore=false;return reply(null,{message:'Test save failed'});}
    let row=db.entries.find(e=>e.id===id&&e.owner_id===user);if(row?row.version!==version:version!=null)return reply(null,{code:'40001'});
    const old=row?.task_id??null;let task=null;
    const clearOld=()=>{db.test_tasks=db.test_tasks.filter(t=>!(t.id===old&&t.owner_id===user));db.hq_task_positions=db.hq_task_positions.filter(p=>!(p.owner_id===user&&p.item_key==='task:'+old));};
    if(action==='delete'){
     assert.ok(row);db.entries=db.entries.filter(e=>e!==row);if(old!=null)clearOld();return reply({entry_id:id,entry:null,task:null,removed_task_id:old});
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
    return reply({entry_id:id,entry:row,task,removed_task_id:old!=null&&old!==task?.id?old:null});
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
  throw Error('Unexpected operation');
 });
 const editor=page.locator('#comingEditor'),field=name=>editor.locator('[name="'+name+'"]'),ready=()=>page.waitForFunction(()=>!document.querySelector('#comingAdd').disabled);
 const save=async()=>{await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#comingEditor').open).catch(async e=>{console.error(await editor.innerText());throw e;});await ready();};
 const add=async({kind='event',title,date='',end='',time='',notes=''})=>{
  await page.locator('#comingAdd').click();await field('kind').selectOption(kind);await field('title').fill(title);await field('start_date').fill(date);
  if(kind==='event'&&end)await field('end_date').fill(end);
  if(time){if(kind==='event')await field('all_day').uncheck();await field('start_time').fill(time);}
  if(notes)await field('notes').fill(notes);await save();
 };
 const goComing=async()=>{await page.locator('#comingLink').click();await page.waitForFunction(()=>!document.querySelector('#comingView').hidden);await ready();};
 const editPlan=title=>page.getByRole('button',{name:'Edit plan '+title,exact:true}).click();
 await page.goto('http://project.test/#coming');assert.equal(await page.locator('#comingAdd').isDisabled(),true);await page.locator('#comingSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();
 assert.equal(await page.locator('#comingSomeday').getAttribute('open'),'');assert.equal(await page.locator('#comingSomedayRows .coming-card').count(),2);assert.match(await page.locator('#comingMonths').innerText(),/Today even after its time/);assert.ok(!(await page.locator('#comingMonths').innerText()).includes('Earlier event'));assert.ok(!(await page.locator('#comingMonths').innerText()).includes('Ordinary garden task'));
 await page.locator('#comingSomeday summary').click();assert.equal(await page.locator('#comingSomeday').getAttribute('open'),null);await page.locator('#comingJump').click();assert.equal(await page.locator('#comingSomeday').getAttribute('open'),'');
 await page.getByRole('checkbox',{name:'Mark Explore a course complete',exact:true}).check();await page.waitForFunction(()=>document.querySelector('#comingSomedayRows .is-complete'));assert.equal(await page.locator('#comingSomedayRows .coming-card').count(),2);await page.getByRole('checkbox',{name:'Mark Explore a course incomplete',exact:true}).uncheck();await ready();
 await add({title:'Marwell Zoo with Amber',date:'2026-11-08',notes:'Meet by the entrance.'});await add({title:'Holiday',date:'2026-11-09',end:'2026-11-13'});await add({kind:'todo',title:'Review deals',date:'2026-11-09',time:'09:30'});await add({kind:'todo',title:'Overdue booking',date:'2026-11-07'});
 const todo=db.entries.find(e=>e.kind==='todo'&&db.test_tasks.find(t=>t.id===e.task_id)?.task==='Review deals'),todoId=todo.task_id;
 assert.equal(db.test_tasks.filter(t=>t.id===todoId).length,1);assert.equal(db.test_tasks.find(t=>t.id===todoId).project,null);assert.match(await page.locator('#comingOverdue').innerText(),/Overdue booking/);
 assert.match(await page.locator('#comingMonths').innerText(),/8 Nov 2026 · Sunday/);await require('./mobile-layout.cjs')(page,'#comingView');await page.screenshot({path:path.join(artifacts,'hq-coming-up.png'),fullPage:true});
 await page.locator('#weekLink').click();await page.waitForFunction(()=>!document.querySelector('#weekView').hidden);assert.equal(await page.locator('[data-date="2026-11-08"] .day-events li').count(),2);assert.equal(await page.locator('[data-date="2026-11-08"] .day-events input').count(),0);
 await page.locator('#nextWeek').click();assert.equal(await page.locator('.day-events li').count(),5);assert.equal(await page.locator('.week-task').filter({has:page.locator('.week-check span',{hasText:'Review deals'})}).count(),1);
 for(const day of ['09','10','11','12','13'])assert.equal(await page.locator('[data-date="2026-11-'+day+'"] .day-events').count(),1);assert.equal(await page.locator('[data-date="2026-11-14"] .day-events').count(),0);
 await page.locator('[data-date="2026-11-09"]').getByRole('button',{name:'Edit event Holiday',exact:true}).click();await field('end_date').fill('2026-11-12');await save();assert.equal(await page.locator('.day-events li').count(),4);
 await page.getByRole('checkbox',{name:'Mark Review deals complete',exact:true}).check();await page.waitForFunction(()=>document.querySelector('[data-date="2026-11-09"] .week-task.done'));await goComing();assert.ok(!(await page.locator('#comingMonths').innerText()).includes('Review deals'));await page.locator('[data-coming-tab=history]').click();await page.waitForFunction(()=>!document.querySelector('#comingHistory').hidden);assert.match(await page.locator('#comingHistory').innerText(),/Earlier event/);assert.match(await page.locator('#comingHistory').innerText(),/Review deals/);
 await page.getByRole('checkbox',{name:'Mark Review deals incomplete',exact:true}).uncheck();await ready();await page.locator('[data-coming-tab=upcoming]').click();await page.waitForFunction(()=>!document.querySelector('#comingUpcoming').hidden);assert.match(await page.locator('#comingMonths').innerText(),/Review deals/);
 await page.locator('#weekLink').click();await page.getByRole('button',{name:'Edit Review deals',exact:true}).click();assert.equal(await editor.isVisible(),true);assert.equal(await page.locator('#taskEditor').isVisible(),false);assert.equal(await field('kind').inputValue(),'todo');await field('title').fill('Review Black Friday deals');await save();assert.equal(db.test_tasks.find(t=>t.id===todoId).task,'Review Black Friday deals');
 await page.getByRole('button',{name:'Move or reorder Review Black Friday deals',exact:true}).click();await page.locator('#moveDay').fill('2026-11-11');await page.locator('#moveDay').dispatchEvent('change');await page.locator('#moveBefore').selectOption('routine:00000000-0000-4000-8000-000000000099:2026-11-11');await page.locator('#moveEditor [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#moveEditor').open);assert.equal(db.test_tasks.find(t=>t.id===todoId).scheduled_date,'2026-11-11');assert.ok(db.hq_task_positions.some(p=>p.day==='2026-11-11'&&p.item_key==='task:'+todoId));
 await goComing();assert.match(await page.locator('[data-plan-id="'+todo.id+'"] .coming-date').innerText(),/11 Nov 2026 · Wednesday/);
 // A stale full reload must not undo a personal task completed while it is in flight.
 delayTasks=true;await page.locator('#comingReload').click();await page.waitForFunction(()=>document.querySelector('#comingStatus').textContent.includes('Loading'));
 await page.locator('#weekLink').click();await page.getByRole('checkbox',{name:'Mark Review Black Friday deals complete',exact:true}).check();await page.waitForFunction(()=>document.querySelector('#weekComingNotice').hidden);releaseTaskLoad();
 await goComing();await page.locator('[data-coming-tab=history]').click();await page.getByRole('checkbox',{name:'Mark Review Black Friday deals incomplete',exact:true}).uncheck();await ready();await page.locator('[data-coming-tab=upcoming]').click();

 // Scheduling uses the same idea ID and, for to-dos, the same task ID.
 await page.locator('#weekLink').click();await page.locator('#weekSomeday summary').click();await page.locator('#weekIdeaChoice').selectOption(undatedTodo);await page.locator('#weekIdeaSchedule').click();await field('start_date').fill('2026-11-10');await save();assert.equal(db.entries.find(e=>e.id===undatedTodo).task_id,1000);assert.equal(db.test_tasks.find(t=>t.id===1000).scheduled_date,'2026-11-10');assert.equal(await page.locator('#weekIdeaChoice option').count(),1);
 await require('./mobile-layout.cjs')(page,'#weekView');await page.screenshot({path:path.join(artifacts,'hq-week-coming-events.png'),fullPage:true});
 // Changing type preserves item identity and atomically replaces task/event shape.
 await goComing();await page.getByRole('button',{name:'Schedule Try pottery',exact:true}).click();await field('kind').selectOption('todo');await field('start_date').fill('2026-11-12');await save();const potteryTask=db.entries.find(e=>e.id===idea).task_id;assert.ok(potteryTask);assert.equal(db.test_tasks.filter(t=>t.id===potteryTask).length,1);
 await editPlan('Try pottery');await field('kind').selectOption('event');await save();assert.equal(db.entries.find(e=>e.id===idea).task_id,null);assert.ok(!db.test_tasks.some(t=>t.id===potteryTask));assert.equal(db.entries.filter(e=>e.id===idea).length,1);
 // Rescheduling overdue and unscheduling a timed task retain their record/notes.
 await page.getByRole('button',{name:'Schedule Overdue booking',exact:true}).click();await field('start_date').fill('2026-11-20');await save();assert.equal(await page.locator('#comingOverdue').isHidden(),true);
 await editPlan('Review Black Friday deals');await field('start_date').fill('');await save();assert.equal(db.test_tasks.find(t=>t.id===todoId).scheduled_date,null);assert.ok(!db.hq_task_positions.some(p=>p.item_key==='task:'+todoId));assert.equal(db.entries.find(e=>e.id===todo.id).start_time,null);assert.match(await page.locator('#comingSomedayRows').innerText(),/Review Black Friday deals/);
 await page.reload();await ready();assert.match(await page.locator('#comingSomedayRows').innerText(),/Review Black Friday deals/);assert.equal(db.test_tasks.filter(t=>t.id===todoId).length,1);
 // Stale metadata cannot overwrite a changed task or event.
 await editPlan('Try pottery');db.entries.find(e=>e.id===idea).version++;await field('title').fill('Stale name');await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#comingEditor [role=alert]').textContent.includes('changed or deleted'));assert.equal(db.entries.find(e=>e.id===idea).title,'Try pottery');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#comingReload').click();await ready();
 // Failed/uncertain saves retain drafts and require checking saved state before retry.
 await page.locator('#comingAddIdea').click();await field('title').fill('Keep my draft');failBefore=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#comingEditor [role=alert]').textContent.includes('Test save failed'));assert.equal(await field('title').inputValue(),'Keep my draft');assert.equal(await editor.locator('[type=submit]').isDisabled(),true);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#comingReload').click();await ready();
 await page.locator('#comingAddIdea').click();await field('title').fill('Saved despite interruption');failAfter=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#comingEditor [role=alert]').textContent.includes('Response interrupted'));await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#comingReload').click();await ready();assert.equal(db.entries.filter(e=>e.title==='Saved despite interruption').length,1);
 // Confirm/cancel deletion, including removal of only the linked personal task.
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete plan Review Black Friday deals',exact:true}).click();assert.ok(db.test_tasks.some(t=>t.id===todoId));page.once('dialog',d=>{assert.match(d.message(),/shared weekly to-do/);return d.accept();});await page.getByRole('button',{name:'Delete plan Review Black Friday deals',exact:true}).click();await ready();assert.ok(!db.test_tasks.some(t=>t.id===todoId));assert.ok(db.test_tasks.some(t=>t.id===1));assert.equal(db.hq_routines.length,1);
 for(const width of [320,350,375,390,430,600,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}await page.setViewportSize({width:390,height:844});
 await editPlan('Holiday');for(const width of [320,375,390]){await page.setViewportSize({width,height:844});assert.equal(await editor.evaluate(e=>e.scrollWidth>e.clientWidth),false);}await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 // Day roll-over uses local calendar midnight, retaining history and overdue data.
 const rowCount=db.entries.length;await page.clock.fastForward(5*60*60*1000);await page.waitForFunction(()=>!document.querySelector('#comingMonths').innerText.includes('Today even after its time'));assert.equal(db.entries.length,rowCount);await page.locator('[data-coming-tab=history]').click();assert.match(await page.locator('#comingHistory').innerText(),/Today even after its time/);
 missing=true;await page.locator('#comingReload').click();await page.waitForFunction(()=>document.querySelector('#comingError').textContent.includes('Stage 3A'));await page.locator('#weekLink').click();await page.locator('#currentWeek').click();assert.ok(await page.getByRole('checkbox',{name:'Mark Ordinary garden task complete',exact:true}).count());missing=false;await page.locator('#comingLink').click();await page.locator('#comingReload').click();await ready();

 await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#comingSignIn').hidden);assert.equal(await page.locator('.coming-card').count(),0);
 await page.locator('#comingSignIn').click();await page.locator('#email').fill('second@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await page.locator('.coming-card').count(),0);
 await page.locator('#logout').click();await page.locator('#comingSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.ok(await page.locator('.coming-card').count());
 await page.locator('#homeLink').click();await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth));assert.equal(await page.locator('.project').count(),6);assert.equal(await page.locator('#tasks .task-name').filter({hasText:'Explore a course'}).count(),0);assert.deepEqual(errors,[]);
 console.log('PASS Coming Up: local dates/today/history/overdue; Someday persistence and collapse; event ranges/time; shared task completion/edit/move/order; weekly events and scheduling; atomic type changes/deletion; drafts/conflicts/unknown commits; midnight; missing schema; sessions; narrow screens/forms and unchanged home photos. Supabase mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
