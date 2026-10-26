// No real Supabase requests: persistent in-memory fixtures exercise UI + refresh.
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), artifacts=process.env.TEST_ARTIFACTS || require('node:os').tmpdir();
const clientModule=`export function createClient(){let callback;return {auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,
 signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},
 rpc:(name,args)=>fetch('/__db',{method:'POST',headers:{'x-test-user':localStorage.user||''},body:JSON.stringify({op:'rpc',name,args})}).then(r=>r.json()),
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api},single:()=>{q.single=true;return api},
 gte:(k,v)=>{q.filters.push(['gte',k,v]);return api},lte:(k,v)=>{q.filters.push(['lte',k,v]);return api},eq:(k,v)=>{q.filters.push(['eq',k,v]);return api},
 upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api},insert:values=>{q.op='insert';q.values=values;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},
 then:(resolve,reject)=>fetch('/__db',{method:'POST',headers:{'x-test-user':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json()).then(resolve,reject)};return api;}}}`;
(async()=>{
 const owner='first@example.com';
 const db={hq_meals:[],hq_shopping_items:[],hq_routines:[],hq_routine_occurrences:[],hq_task_positions:[],test_tasks:[{owner_id:owner,id:1,project:'Garden',task:'Plant seeds',completed:false,scheduled_date:'2026-10-26'}]};
 let next=1, failWrite=false, missing=false, delayWeek=null, releaseLoad=null;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'});
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.message);});
  await page.clock.install({time:new Date('2026-10-28T12:00:00Z')});
  await page.route('https://esm.sh/**',route=>route.fulfill({contentType:'application/javascript',body:clientModule}));
  await page.route('http://project.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname!=='/__db'){
    const file=pathname==='/'?'/index.html':pathname;
    return route.fulfill({body:fs.readFileSync(root+file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html'});
   }
   const q=JSON.parse(route.request().postData()), user=route.request().headers()['x-test-user'];
   if(q.op==='rpc') {
    assert.equal(q.name,'hq_move_task');const {p_item_key:key,p_day:day,p_order:order}=q.args;
    const task=db.test_tasks.find(t=>t.owner_id===user&&`task:${t.id}`===key);assert.ok(task);task.scheduled_date=day;
    db.hq_task_positions=db.hq_task_positions.filter(p=>p.owner_id!==user||(p.day!==day&&p.item_key!==key)).concat(order.map((item_key,position)=>({owner_id:user,day,item_key,position})));
    return route.fulfill({json:{data:{task,occurrence:null},error:null}});
   }
   assert.ok(db[q.table],q.table);
   if(missing&&q.table.startsWith('hq_')&&['hq_meals','hq_shopping_items'].includes(q.table))return route.fulfill({json:{error:{code:'PGRST205'}}});
   if(failWrite&&q.op!=='list'){failWrite=false;return route.fulfill({json:{error:{message:'Test offline'}}});}
   if(q.op==='list'&&q.table==='hq_meals'&&q.filters.some(f=>f[1]==='meal_date'&&f[2]===delayWeek))await new Promise(resolve=>releaseLoad=resolve);
   const matches=row=>row.owner_id===user&&q.filters.every(([op,k,v])=>op==='eq'?row[k]===v:op==='gte'?row[k]>=v:row[k]<=v);
   let data;
   if(q.op==='list')data=db[q.table].filter(matches).slice(q.range[0],q.range[1]+1);
   if(q.op==='upsert'){
    assert.equal(q.table,'hq_meals');assert.deepEqual(q.options,{onConflict:'owner_id,meal_date'});
    data=q.values.map(values=>{
     let row=db.hq_meals.find(r=>r.owner_id===user&&r.meal_date===values.meal_date);
     if(row)Object.assign(row,values);else{row={owner_id:user,...values};db.hq_meals.push(row);}return row;
    });
   }
   if(q.op==='insert'){data={id:String(next++),owner_id:user,checked:false,created_at:String(next),...q.values};db[q.table].push(data);}
   if(q.op==='update'){data=db[q.table].find(matches);Object.assign(data,q.values);}
   if(q.op==='delete'){data=db[q.table].find(matches);db[q.table]=db[q.table].filter(row=>row!==data);}
   return route.fulfill({json:{data,error:null}});
  });
  const signIn=async email=>{await page.locator('#email').fill(email);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();};
  const log=message=>{if(process.env.DEBUG_MEALS)console.log(message);};
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#mealSave').disabled);
  const meal=async()=>{await page.locator('a[href="#meals"]').click();await page.waitForFunction(()=>!document.querySelector('#mealView').hidden);await ready();};
  const save=async()=>{await page.locator('#mealSave').click();await page.waitForFunction(()=>document.querySelector('#mealStatus').textContent==='Meals saved.');};
  const add=async text=>{await page.locator('#shoppingText').fill(text);await page.locator('#shoppingAdd').click();await page.waitForFunction(()=>document.querySelector('#mealStatus').textContent==='Shopping list saved.');};
  await page.goto('http://project.test/#week');await page.locator('#weekSignIn').click();await signIn(owner);await page.waitForFunction(()=>document.querySelectorAll('.week-task').length===1);
  log('signed in');await meal();log('meal ready');assert.equal(await page.locator('.meal-day').count(),7);assert.equal(await page.locator('.meal-day input').count(),14);assert.equal(await page.locator('#mealRange').innerText(),'26 Oct – 1 Nov 2026');
  await page.locator('#lunch-2026-10-26').fill('Soup & bread');await page.locator('#dinner-2026-10-26').fill('Roast vegetables');await page.locator('#dinner-2026-11-01').fill('Sunday roast');assert.equal(await page.locator('#mealPlanned').innerText(),'3 of 14 planned');await save();
  assert.equal(db.hq_meals.length,7);assert.equal(db.hq_shopping_items.length,0,'no automatic ingredients');
  log('meals saved');await add('Bread');await add('Apples');log('shopping added');assert.equal(await page.locator('#shoppingProgress').innerText(),'0 of 2 collected');
  await page.locator('#shoppingItems input').first().check();await page.waitForFunction(()=>document.querySelector('#shoppingItems input').checked&&!document.querySelector('#shoppingItems input').disabled);
  assert.equal(await page.locator('#shoppingProgress').innerText(),'1 of 2 collected');
  log('shopping checked');await page.locator('#backFromMeals').click();await page.waitForFunction(()=>!document.querySelector('#weekView').hidden);
  const summary=page.locator('[data-date="2026-10-26"] .day-meals');assert.match(await summary.innerText(),/Lunch\s+Soup & bread/);assert.equal(await summary.locator('input').count(),0);
  assert.equal(await page.locator('[data-date="2026-10-26"] .day-content').evaluate(el=>el.firstElementChild.className),'day-meals');
  assert.equal(await page.locator('[data-date="2026-10-26"] .week-check span').innerText(),'Plant seeds');
  // Meals are not draggable tasks and do not interfere with task gestures or completion.
  const cdp=await context.newCDPSession(page), taskBody=await page.locator('[data-item-key="task:1"] .week-check span').boundingBox(), targetDay=await page.locator('[data-date="2026-10-27"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:taskBody.x+10,y:taskBody.y+5}]});await page.clock.runFor(350);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:targetDay.x+150,y:targetDay.y+20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-27"] [data-item-key="task:1"]'));
  assert.match(await page.locator('[data-date="2026-10-26"] .day-meals').innerText(),/Roast vegetables/);
  await page.getByRole('button',{name:'Move or reorder Plant seeds',exact:true}).click();await page.locator('#moveDay').fill('2026-10-26');await page.locator('#moveEditor button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#moveEditor').open);
  await page.locator('[data-item-key="task:1"] input').check();await page.waitForFunction(()=>document.querySelector('.week-task.done'));
  await page.locator('[data-item-key="task:1"] input').uncheck();await page.waitForFunction(()=>!document.querySelector('.week-task.done'));

  log('summary checked');await meal();await page.locator('#lunch-2026-10-26').fill('Unsaved draft');await page.locator('#mealNext').click();await ready();
  assert.equal(await page.locator('#mealRange').innerText(),'2 Nov – 8 Nov 2026');assert.equal(await page.locator('#lunch-2026-11-02').inputValue(),'');assert.equal(await page.locator('#shoppingItems li').count(),0);
  await page.locator('#dinner-2026-11-02').fill('Pasta');await save();await add('Milk');
  await page.locator('#mealPrevious').click();await ready();assert.equal(await page.locator('#lunch-2026-10-26').inputValue(),'Unsaved draft');assert.equal(await page.locator('#shoppingItems li').count(),2);
  await page.locator('#backFromMeals').click();assert.match(await page.locator('[data-date="2026-10-26"] .day-meals').innerText(),/Soup & bread/);assert.doesNotMatch(await page.locator('[data-date="2026-10-26"] .day-meals').innerText(),/Unsaved/);
  log('weeks isolated');await page.reload();await page.waitForFunction(()=>document.querySelector('.day-meals'));
  await meal();assert.equal(await page.locator('#lunch-2026-10-26').inputValue(),'Soup & bread');assert.equal(await page.locator('#shoppingItems input').first().isChecked(),true);
  await page.locator('#shoppingItems input').first().uncheck();await page.waitForFunction(()=>!document.querySelector('#shoppingItems input').checked&&!document.querySelector('#shoppingItems input').disabled);
  failWrite=true;await page.locator('#shoppingItems input').first().tap();await page.waitForFunction(()=>document.querySelector('#mealError').textContent.includes('Test offline'));assert.equal(await page.locator('#shoppingItems input').first().isChecked(),false);
  failWrite=true;await page.locator('#lunch-2026-10-26').fill('Keep my draft');await page.locator('#mealSave').click();await page.waitForFunction(()=>document.querySelector('#mealError').textContent.includes('Test offline')&&!document.querySelector('#mealSave').disabled);
  assert.equal(await page.locator('#lunch-2026-10-26').inputValue(),'Keep my draft');assert.equal(db.hq_meals.find(r=>r.meal_date==='2026-10-26').lunch,'Soup & bread');await save();
  await page.locator('#lunch-2026-10-26').fill('');assert.equal(await page.locator('#mealPlanned').innerText(),'2 of 14 planned');await save();assert.equal(db.hq_meals.find(r=>r.meal_date==='2026-10-26').lunch,'');
  await page.locator('#shoppingItems .delete').last().click();await page.waitForFunction(()=>document.querySelectorAll('#shoppingItems li').length===1);assert.equal(db.hq_shopping_items.filter(r=>r.week_start==='2026-11-02').length,1);
  // Delayed previous-week load must not overwrite the next week's UI.
  delayWeek='2026-10-19';await page.locator('#mealPrevious').click();await page.waitForFunction(()=>document.querySelector('#mealStatus').textContent.includes('Loading'));
  await page.locator('#mealNext').click();await ready();assert.equal(await page.locator('#mealRange').innerText(),'26 Oct – 1 Nov 2026');
  delayWeek=null;releaseLoad();await page.clock.runFor(100);assert.equal(await page.locator('#dinner-2026-10-26').inputValue(),'Roast vegetables');
  await page.locator('#mealNext').click();await ready();await page.locator('#backFromMeals').click();await page.waitForFunction(()=>document.querySelector('#weekRange').textContent.includes('2 Nov'));
  assert.match(await page.locator('[data-date="2026-11-02"] .day-meals').innerText(),/Pasta/);
  await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>document.querySelector('#dashboard').hidden);assert.equal(await page.locator('.day-meals').count(),0);
  await page.locator('#weekSignIn').click();await signIn('second@example.com');await meal();assert.equal(await page.locator('#shoppingItems li').count(),0);assert.ok((await page.locator('.meal-day input').evaluateAll(inputs=>inputs.map(i=>i.value))).every(v=>v===''));
  await page.locator('#menuToggle').click();if(!await page.locator('#logout').isVisible())await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.locator('#mealSignIn').click();await signIn(owner);await ready();
  await page.locator('#mealCurrent').click();await ready();assert.equal(await page.locator('#dinner-2026-10-26').inputValue(),'Roast vegetables');assert.equal(await page.locator('#shoppingItems li').count(),1);
  // Presentation checks: long copy, paired fields, seven cards and unchanged touch targets.
  await page.locator('#lunch-2026-10-26').fill('Roasted vegetables with chickpeas and a very long description');
  for(const width of [320,350,375,390,430,600,768,1440]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const layout=await page.locator('.meal-day').first().evaluate(day=>{
      const [lunch,dinner]=day.querySelectorAll('input'), a=lunch.getBoundingClientRect(), b=dinner.getBoundingClientRect();
      return {sameRow:Math.abs(a.top-b.top)<1,rounded:parseFloat(getComputedStyle(day).borderRadius)>0,fieldHeight:a.height,font:parseFloat(getComputedStyle(lunch).fontSize)};
    });
    assert.equal(layout.sameRow,true);assert.equal(layout.rounded,true);assert.ok(layout.fieldHeight>=44);assert.ok(layout.font>=16);
    assert.equal(await page.locator('.meal-day').count(),7);
    assert.ok(await page.locator('.meal-feature').evaluate(el=>el.getBoundingClientRect().height<=170));
    assert.ok(await page.locator('#shoppingItems .delete').first().evaluate(el=>el.getBoundingClientRect().height>=44&&el.getBoundingClientRect().width>=44));
    assert.ok(await page.locator('#shoppingItems label').first().evaluate(el=>el.getBoundingClientRect().height>=44));
  }

  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'hq-meal-planner.png'),fullPage:true});
  // Missing migration is isolated and retryable; task lists remain usable.
  missing=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#mealError').textContent.includes('not available yet'));assert.equal(await page.locator('#mealSave').isDisabled(),true);
  log('shopping checked');await page.locator('#backFromMeals').click();await page.waitForFunction(()=>document.querySelectorAll('.week-task').length===1);assert.equal(await page.locator('.week-check span').innerText(),'Plant seeds');
  await page.locator('a[href="#meals"]').click();missing=false;await page.locator('#mealRetry').click();await ready();assert.equal(await page.locator('#dinner-2026-10-26').inputValue(),'Roast vegetables');
  assert.equal(db.test_tasks.length,1);assert.equal(db.test_tasks[0].task,'Plant seeds');assert.equal(db.hq_routines.length,0);assert.deepEqual(errors,[]);
  console.log('PASS meals: week/date navigation, editing/clearing, saved day summaries, manual shopping add/check/uncheck/delete, independent weeks, refresh/sign-in, drafts/error recovery, stale responses, missing migration, 320–1440px layout (mock Supabase).');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
