// Runs entirely against local files and an in-memory Supabase double.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.TEST_ARTIFACTS || require('node:os').tmpdir();
const clientModule = `export function createClient(){let callback;return {
 auth:{getSession:async()=>({data:{session:localStorage.signedIn?{}:null}}),onAuthStateChange:fn=>callback=fn,
 signInWithPassword:async()=>{localStorage.signedIn='1';return {error:null}},signOut:async()=>{delete localStorage.signedIn;callback?.('SIGNED_OUT');return {error:null}}},
 rpc:(name,args)=>fetch('/__db',{method:'POST',body:JSON.stringify({op:'rpc',name,args})}).then(r=>r.json()),
 from(table){const q={table,op:'list'};const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api},single:()=>api,
 insert:values=>{q.op='insert';q.values=values;return api},upsert:values=>{q.op='upsert';q.values=values;return api},
 update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},eq:(k,v)=>{q.id=v;return api},
 then:(resolve,reject)=>fetch('/__db',{method:'POST',body:JSON.stringify(q)}).then(r=>r.json()).then(resolve,reject)};return api;}}}`;

(async () => {
  const db = {
    test_tasks:[{id:1,task:'Ordinary plan',project:'Garden',completed:false,scheduled_date:'2026-10-26'}, {id:2,task:'Undated project task',project:'Book Nook',completed:false,scheduled_date:null}],
    hq_routines:[], hq_routine_occurrences:[], hq_task_positions:[]
  };
  let next = 10, writes = 0, failNext = false;
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
    await page.route('https://esm.sh/**', route => route.fulfill({contentType:'application/javascript',body:clientModule}));
    await page.route('http://project.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname !== '/__db') {
        const file = pathname === '/' ? '/index.html' : pathname;
        return route.fulfill({body:fs.readFileSync(root+file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.jpg')?'image/jpeg':'text/html'});
      }
      const q = JSON.parse(route.request().postData());
      if (q.op !== 'list') {
        writes++;
        if (failNext) { failNext = false; return route.fulfill({json:{error:{message:'Test save failed'}}}); }
      }
      let data;
      if (q.op === 'rpc') {
        assert.equal(q.name,'hq_move_task');
        const {p_item_key:key,p_day:day,p_order:order}=q.args;
        assert.equal(new Set(order).size,order.length);
        let task = null, occurrence = null;
        if (key.startsWith('task:')) { task=db.test_tasks.find(t=>t.id===Number(key.split(':')[1]));task.scheduled_date=day; }
        else {
          const [,routine_id,occurrence_date]=key.split(':');
          occurrence=db.hq_routine_occurrences.find(o=>o.routine_id===routine_id&&o.occurrence_date===occurrence_date);
          if (!occurrence) { occurrence={routine_id,occurrence_date,completed:false,skipped:false,task:null,project:null};db.hq_routine_occurrences.push(occurrence); }
          occurrence.scheduled_date=day;
        }
        db.hq_task_positions=db.hq_task_positions.filter(p=>p.day!==day&&p.item_key!==key).concat(order.map((item_key,position)=>({day,item_key,position})));
        data={task,occurrence};
      } else {
        const table=db[q.table];assert.ok(table,q.table);
        if (q.op === 'list') data=table.slice(q.range[0],q.range[1]+1);
        if (q.op === 'insert') {
          data={id:q.table==='hq_routines'?`00000000-0000-4000-8000-${String(next++).padStart(12,'0')}`:next++,paused:false,deleted:false,completed:false,scheduled_date:null,...q.values};table.push(data);
        }
        if (q.op === 'update') { data=table.find(t=>t.id===q.id);Object.assign(data,q.values); }
        if (q.op === 'upsert') {
          data=table.find(o=>o.routine_id===q.values.routine_id&&o.occurrence_date===q.values.occurrence_date);
          if (data) Object.assign(data,q.values);else {data={...q.values};table.push(data);}
        }
        if (q.op === 'delete') {data={id:q.id};db[q.table]=table.filter(t=>t.id!==q.id);}
      }
      return route.fulfill({json:{data,error:null}});
    });
    const waitClosed = id => page.waitForFunction(id=>!document.getElementById(id).open,id);
    const saveRoutine = async () => { await page.locator('#routineEditor button[type=submit]').click();await waitClosed('routineEditor'); };
    const week = async () => { await page.locator('#weekLink').click();await page.waitForFunction(()=>!document.querySelector('#weekView').hidden); };
    const manage = async () => { await page.locator('a[href="#routines"]').click();await page.waitForFunction(()=>!document.querySelector('#routinesView').hidden); };
    const tasksOn = date => page.locator(`[data-date="${date}"] .week-check span`);
    await page.goto('http://project.test/#week');
    await page.locator('#weekSignIn').click();await page.locator('#email').fill('test@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.week-task').length===1);
    await manage();await page.locator('[data-add-routine]').click();
    await page.locator('#routineTask').fill('Read a little');await page.locator('#routineStart').fill('2026-10-26');await saveRoutine();
    assert.equal(db.hq_routines.length,1);assert.equal(db.hq_routines[0].project,'Other');
    await week();assert.equal(await page.locator('.repeat-icon').count(),7);
    const initialWrites=writes;
    for(let n=0;n<20;n++)await page.locator('#nextWeek').click();
    assert.equal(await page.locator('.repeat-icon').count(),7);assert.equal(writes,initialWrites);assert.equal(db.hq_routine_occurrences.length,0);
    await page.locator('#currentWeek').click();
    await page.locator('[data-date="2026-10-26"] .week-task').filter({hasText:'Read a little'}).locator('input').check();
    await page.waitForFunction(()=>document.querySelectorAll('.week-task.done').length===1);
    assert.equal(db.hq_routine_occurrences.length,1);assert.equal(await page.locator('[data-date="2026-10-27"] input').isChecked(),false);
    await page.locator('[data-date="2026-10-26"] .week-task').filter({hasText:'Read a little'}).locator('input').uncheck();
    await page.waitForFunction(()=>document.querySelectorAll('.week-task.done').length===0);
    await page.locator('[data-date="2026-10-26"] .week-task').filter({hasText:'Read a little'}).locator('input').check();
    await page.waitForFunction(()=>document.querySelectorAll('.week-task.done').length===1);
    assert.equal(db.hq_routine_occurrences.length,1);
    await page.getByRole('button',{name:'Edit Read a little',exact:true}).nth(1).click();
    await page.locator('#plannerTask').fill('Read with tea');await page.locator('#plannerDate').fill('2026-11-03');await page.locator('#taskEditor button[type=submit]').click();await waitClosed('taskEditor');
    await page.locator('#nextWeek').click();assert.equal(await page.locator('[data-date="2026-11-03"] .week-task').count(),2);
    await page.getByRole('button',{name:'Edit Read with tea',exact:true}).click();page.once('dialog',d=>d.accept());await page.locator('#taskEditor [data-delete]').click();await waitClosed('taskEditor');
    assert.equal(await page.getByRole('button',{name:'Edit Read with tea',exact:true}).count(),0);
    await page.locator('#includeSkipped').check();await page.locator('.is-skipped button').click();await page.waitForFunction(()=>!document.querySelector('.is-skipped'));
    assert.equal(await page.getByRole('button',{name:'Edit Read with tea',exact:true}).count(),1);
    await page.locator('#currentWeek').click();
    const routineId=db.hq_routines[0].id, occurrenceKey=`routine:${routineId}:2026-10-26`;
    await page.getByRole('button',{name:'Move or reorder Read a little',exact:true}).first().click();
    await page.locator('#moveBefore').selectOption('task:1');await page.locator('#moveEditor button[type=submit]').click();await waitClosed('moveEditor');
    assert.deepEqual(await tasksOn('2026-10-26').allTextContents(),['Read a little','Ordinary plan']);
    assert.equal(db.hq_task_positions.find(p=>p.item_key===occurrenceKey).position,0);
    // Same day touch drag using actual Chromium touch input, not synthetic DOM events.
    const cdp=await context.newCDPSession(page);
    // Reorder the mixed day by touch, then drag the recurring occurrence to another day.
    const ordinaryHandle=await page.locator('[data-item-key="task:1"] .drag-handle').boundingBox();
    const firstRow=await page.locator('[data-date="2026-10-26"] .week-task').first().boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ordinaryHandle.x+15,y:ordinaryHandle.y+20}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:firstRow.x+15,y:firstRow.y+5}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-26"] .week-task').dataset.itemKey==='task:1');
    assert.deepEqual(await tasksOn('2026-10-26').allTextContents(),['Ordinary plan','Read a little']);
    const source=await page.locator(`[data-item-key="${occurrenceKey}"] .drag-handle`).boundingBox();
    const destination=await page.locator('[data-date="2026-10-28"]').boundingBox();
    const sx=source.x+source.width/2,sy=source.y+source.height/2,dx=destination.x+destination.width/2,dy=destination.y+25;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+10,y:sy+10}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dx,y:dy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-28"] [data-item-key$=":2026-10-26"]'));
    assert.equal(db.hq_routine_occurrences.find(o=>o.occurrence_date==='2026-10-26').scheduled_date,'2026-10-28');
    assert.equal(db.hq_routine_occurrences.find(o=>o.occurrence_date==='2026-10-26').completed,true);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.repeat-icon').length===6);
    assert.equal(await page.locator('[data-date="2026-10-28"] .week-task').count(),2);
    assert.equal(await page.locator('[data-date="2026-10-28"] .week-task').first().getAttribute('data-item-key'),occurrenceKey);
    const beforeFailed=JSON.stringify(db.hq_task_positions);failNext=true;
    await page.getByRole('button',{name:'Move or reorder Ordinary plan',exact:true}).click();await page.locator('#moveDay').fill('2026-10-30');await page.locator('#moveEditor button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#moveEditor [role=alert]').textContent.includes('Test save failed'));
    assert.equal(JSON.stringify(db.hq_task_positions),beforeFailed);await page.locator('#moveEditor button[type=submit]').click();await waitClosed('moveEditor');
    assert.equal(db.test_tasks[0].scheduled_date,'2026-10-30');
    await manage();await page.getByRole('button',{name:'Pause routine Read a little',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.routine-row p').textContent.includes('Paused'));
    await week();assert.equal(await page.locator('.repeat-icon').count(),1); // explicit completed plan only; the other move is next week
    await manage();await page.getByRole('button',{name:'Resume routine Read a little',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.routine-row p').textContent.includes('Paused'));
    await page.getByRole('button',{name:'Edit routine Read a little',exact:true}).click();await page.locator('#routineTask').fill('Daily reading');await saveRoutine();
    await week();assert.equal(await page.getByRole('button',{name:'Edit Daily reading',exact:true}).count(),5);
    // Weekly/fortnightly multi-day controls and inclusive dates.
    await manage();await page.locator('[data-add-routine]').click();await page.locator('#routineTask').fill('Stretch');await page.locator('#routineFrequency').selectOption('fortnightly');
    for(const checkbox of await page.locator('[name=weekday]').all())await checkbox.uncheck();await page.locator('#routineEditor button[type=submit]').click();assert.match(await page.locator('#routineEditor [role=alert]').innerText(),/weekday/);
    await page.locator('[name=weekday][value="1"]').check();await page.locator('[name=weekday][value="3"]').check();await page.locator('#routineEnd').fill('2026-11-15');await saveRoutine();
    await week();assert.equal(await page.getByRole('button',{name:'Edit Stretch',exact:true}).count(),2);await page.locator('#nextWeek').click();assert.equal(await page.getByRole('button',{name:'Edit Stretch',exact:true}).count(),0);await page.locator('#nextWeek').click();assert.equal(await page.getByRole('button',{name:'Edit Stretch',exact:true}).count(),2);
    await page.locator('#currentWeek').click();await manage();await page.getByRole('button',{name:'Edit routine Daily reading',exact:true}).click();page.once('dialog',d=>d.accept());await page.locator('[data-delete-routine]').click();await waitClosed('routineEditor');
    assert.equal(db.hq_routines[0].deleted,true);await week();assert.equal(await page.getByRole('button',{name:'Edit Daily reading',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Edit Read a little',exact:true}).count(),1);
    await page.locator('#nextWeek').click();assert.equal(await page.getByRole('button',{name:'Edit Read with tea',exact:true}).count(),0);
    await page.locator('#currentWeek').click();await manage();
    await page.locator('[data-add-routine]').click();await page.locator('#routineTask').fill('Monthly reset');await page.locator('#routineFrequency').selectOption('monthly');await page.locator('#routineStart').fill('2026-01-31');await saveRoutine();
    await week();assert.equal(await page.locator('[data-date="2026-10-31"] .week-task').count(),1);
    await manage();await page.locator('[data-add-routine]').click();await page.locator('#routineTask').fill('Weekly tidy');await page.locator('#routineFrequency').selectOption('weekly');
    await page.locator('[name=weekday][value="5"]').check();await page.locator('#routineEnd').fill('2026-10-25');await page.locator('#routineEditor button[type=submit]').click();
    assert.match(await page.locator('#routineEditor [role=alert]').innerText(),/end date/);await page.locator('#routineEnd').fill('2026-11-30');await saveRoutine();
    await week();assert.equal(await page.getByRole('button',{name:'Edit Weekly tidy',exact:true}).count(),2);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.week-day').length===7);assert.equal(db.test_tasks[1].scheduled_date,null);
    for(const width of [320,350,375,390,430,600,768,1440]){
      await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.setViewportSize({width:390,height:844});await page.locator('#currentWeek').click();await page.screenshot({path:path.join(artifacts,'hq-routines-week.png'),fullPage:true});
    await manage();await page.screenshot({path:path.join(artifacts,'hq-routines-manage.png'),fullPage:true});
    // Regression: missing/empty database dates must not throw while listing or opening forms.
    db.hq_routines.push({id:'00000000-0000-4000-8000-000000000099',task:'Legacy dates',project:'Other',frequency:'daily',weekdays:[],paused:false,deleted:false});
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.week-day').length===7);await week();await manage();
    assert.match(await page.locator('.routine-row').filter({hasText:'Legacy dates'}).innerText(),/date not set/);
    await page.getByRole('button',{name:'Edit routine Legacy dates',exact:true}).click();
    assert.equal(await page.locator('#routineStart').inputValue(),'2026-10-26');assert.equal(await page.locator('#routineEnd').inputValue(),'');
    assert.equal(await page.locator('#routineEditor [role=alert]').innerText(),'');await page.locator('#routineEditor [data-cancel]').click();
    await page.locator('[data-add-routine]').click();assert.equal(await page.locator('#routineStart').inputValue(),'2026-10-26');assert.equal(await page.locator('#routineEnd').inputValue(),'');
    assert.equal(await page.locator('#routineEditor [role=alert]').innerText(),'');await page.locator('#routineTask').fill('No end date');await saveRoutine();
    assert.equal(db.hq_routines.find(r=>r.task==='No end date').end_date,null);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.routine-row').length>0);
    await page.getByRole('button',{name:'Edit routine No end date',exact:true}).click();assert.equal(await page.locator('#routineEnd').inputValue(),'');await page.locator('#routineEditor [data-cancel]').click();
    await page.locator('#homeLink').click();await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth));assert.equal(await page.locator('.project').count(),6);
    await page.locator('.books').click();assert.equal(await page.locator('#tasks .task-name').innerText(),'Undated project task');
    await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>document.querySelector('#dashboard').hidden);await week();assert.equal(await page.locator('.week-task').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS routines lifecycle, occurrence independence/skip/move, bounded future browsing, touch drag, mixed saved ordering and refresh, fallback Move, failed saves, dates, ordinary tasks, photos, mobile layout and sign-out (mock Supabase).');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
