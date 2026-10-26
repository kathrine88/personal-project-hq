const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS || require('node:os').tmpdir();
const moduleCode=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},rpc:name=>send({op:'rpc',name}),
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:()=>api,single:()=>api,maybeSingle:()=>api,gte:()=>api,lte:()=>api,
 eq:(k,v)=>{q.filters.push([k,v]);return api},upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const db={hq_money_daily:[],hq_money_movements:[],hq_money_purchases:[]};let missing=false,failWrite=false,failAfterSave=false,failLoad=false;
 const owner='owner@example.com';
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'});const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
 await page.route('https://esm.sh/**',route=>route.fulfill({contentType:'application/javascript',body:moduleCode}));
 await page.route('http://project.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname!=='/__db'){const file=pathname==='/'?'/index.html':pathname;return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html',body:fs.readFileSync(root+file)});}
  const q=JSON.parse(route.request().postData()),user=route.request().headers()['x-owner'];
  const reply=(data,error=null)=>route.fulfill({json:{data,error}});
  if(q.op==='rpc'){
   assert.equal(q.name,'hq_money_snapshot');if(missing)return reply(null,{code:'PGRST202'});
   if(failLoad){failLoad=false;return reply(null,{message:'Test snapshot failed'});}
   return reply({daily:db.hq_money_daily.filter(r=>r.owner_id===user),movements:db.hq_money_movements.filter(r=>r.owner_id===user),purchases:db.hq_money_purchases.filter(r=>r.owner_id===user)});
  }
  if(!db[q.table])return reply([],null); // Other app features are not modified.
  if(failWrite&&q.op!=='list'){failWrite=false;return reply(null,{message:'Test save failed'});}
  const rows=db[q.table],matches=row=>row.owner_id===user&&q.filters.every(([k,v])=>row[k]===v);
  if(q.op==='list'){const filtered=rows.filter(matches);return reply(q.filters.length?(filtered[0]||null):filtered);}
  if(q.op==='upsert'){
   assert.equal(q.options.ignoreDuplicates,true);if(rows.some(r=>r.id===q.values.id))return reply(null);
   if(q.table==='hq_money_daily'&&rows.some(r=>r.owner_id===user&&r.entry_date===q.values.entry_date))return reply(null,{code:'23505'});
   const row={owner_id:user,version:1,created_at:'2026-10-26T12:00:00Z',...q.values};rows.push(row);if(failAfterSave){failAfterSave=false;failLoad=true;}return reply(row);
  }
  const row=rows.find(matches);if(!row)return reply(null,{code:'PGRST116'});
  if(q.op==='update'){
   if(q.table==='hq_money_daily'&&rows.some(r=>r!==row&&r.owner_id===user&&r.entry_date===q.values.entry_date))return reply(null,{code:'23505'});
   Object.assign(row,q.values);return reply(row);
  }
  if(q.op==='delete'){db[q.table]=rows.filter(r=>r!==row);return reply({id:row.id});}
 });
 const visible=()=>page.waitForFunction(()=>!document.querySelector('#moneyView').hidden);
 const ready=()=>page.waitForFunction(()=>!document.querySelector('[data-new-money="daily"]').disabled);
 const route=async hash=>{await page.evaluate(hash=>location.hash=hash,hash);await visible();await ready();};
 const edit=page.locator('#moneyEditor');
 const fill=async(name,value)=>page.locator('#money-field-'+name).fill(value);
 const save=async()=>{await edit.locator('button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#moneyEditor').open);};
 const amount=()=>page.locator('[data-total=available]').innerText();
 const daily=async(date,value)=>{await route('#money-daily');await page.locator('[data-new-money=daily]').click();await fill('date',date);await fill('amount',value);await save();};
 const movement=async(kind,value)=>{await route('#money-daily');await page.locator('[data-new-money=movements]').click();await page.locator('#money-field-kind').selectOption(kind);await fill('amount',value);await save();};
 const deleteCurrent=async()=>{page.once('dialog',d=>d.accept());await edit.getByRole('button',{name:'Delete record',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#moneyEditor').open);};
 await page.goto('http://project.test/#money');await visible();assert.equal(await amount(),'—');await page.locator('#moneySignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await amount(),'£0.00');
 assert.equal(db.hq_money_daily.length,0);assert.equal(db.hq_money_purchases.length,0);
 await daily('2026-10-26','100.10');await daily('2026-10-25','-20.05');assert.equal(await amount(),'£80.05');assert.match(await page.locator('#moneyDailyRows li').first().innerText(),/26 Oct/);
 await movement('deposit','50.00');await movement('withdrawal','5.00');assert.equal(await amount(),'£125.05');
 await page.locator('[data-new-money=daily]').click();await fill('amount','1.00');await edit.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#moneyEditor [role=alert]').textContent.includes('already exists'));assert.equal(db.hq_money_daily.length,2);await edit.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Edit daily result 2026-10-26',exact:true}).click();await fill('amount','120.10');await save();assert.equal(await amount(),'£145.05');
 await route('#money-purchases');await page.locator('[data-new-money=purchases]').click();await fill('item','Garden bench');await page.locator('#money-field-project').selectOption('Garden');await fill('estimate','40.00');await fill('notes','Solid wood');await fill('source','https://example.com/bench');await save();assert.equal(await amount(),'£145.05');assert.equal(await page.locator('[data-total=planned]').innerText(),'£40.00');
 await page.getByRole('button',{name:'Mark Garden bench purchased',exact:true}).click();await fill('actual','35.00');await save();assert.equal(await amount(),'£110.05');assert.equal(await page.locator('[data-total=spent]').innerText(),'£35.00');
 await page.reload();await ready();assert.equal(await amount(),'£110.05');assert.equal(db.hq_money_purchases.length,1);
 await page.getByRole('button',{name:'Edit purchase Garden bench',exact:true}).click();await fill('estimate','80.00');await fill('actual','30.00');await save();assert.equal(await amount(),'£115.05');
 await page.getByRole('button',{name:'Edit purchase Garden bench',exact:true}).click();await page.locator('#money-field-status').selectOption('planned');await save();assert.equal(await amount(),'£145.05');assert.equal(await page.locator('[data-total=planned]').innerText(),'£80.00');
 await page.getByRole('button',{name:'Mark Garden bench purchased',exact:true}).click();await save();assert.equal(await amount(),'£65.05');assert.equal(db.hq_money_purchases[0].actual_pence,8000);
 await page.getByRole('button',{name:'Edit purchase Garden bench',exact:true}).click();await deleteCurrent();assert.equal(await amount(),'£145.05');
 // Failed saves retain fields; a successful save with failed refresh is not resubmitted.
 await page.locator('[data-new-money=purchases]').click();await fill('item','A free book');await fill('estimate','0');await page.locator('#money-field-status').selectOption('purchased');failWrite=true;await edit.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#moneyEditor [role=alert]').textContent.includes('Test save failed'));assert.equal(await page.locator('#money-field-item').inputValue(),'A free book');
 failAfterSave=true;await save();assert.equal(await amount(),'—');assert.match(await page.locator('#moneyError').innerText(),/Saved, but/);assert.equal(db.hq_money_purchases.length,1);await page.locator('#moneyReload').click();await ready();assert.equal(await amount(),'£145.05');assert.equal(db.hq_money_purchases.length,1);
 // A stale version cannot overwrite another tab's financial edit.
 await route('#money-daily');await page.getByRole('button',{name:'Edit daily result 2026-10-26',exact:true}).click();db.hq_money_daily.find(r=>r.entry_date==='2026-10-26').version++;
 await fill('amount','999');await edit.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#moneyEditor [role=alert]').textContent.includes('record changed'));assert.equal(db.hq_money_daily.find(r=>r.entry_date==='2026-10-26').amount_pence,12010);await edit.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#moneyReload').click();await ready();
 await page.getByRole('button',{name:'Edit daily result 2026-10-25',exact:true}).click();await deleteCurrent();assert.equal(await amount(),'£165.10');
 await page.getByRole('button',{name:'Edit withdrawal 2026-10-26',exact:true}).click();await fill('amount','10.00');await save();assert.equal(await amount(),'£160.10');
 await page.getByRole('button',{name:'Edit deposit 2026-10-26',exact:true}).click();await deleteCurrent();assert.equal(await amount(),'£110.10');
 await route('#money-purchases');await page.locator('[data-new-money=purchases]').click();await fill('item','Christmas lights');await fill('estimate','12.34');await page.locator('#money-field-project').selectOption('Christmas Planning');await save();assert.equal(await amount(),'£110.10');
 await page.locator('#moneyProjectFilter').selectOption('Garden');assert.equal(await page.locator('#moneyPurchaseRows li').count(),0);await page.locator('#moneyProjectFilter').selectOption('Christmas Planning');assert.equal(await page.locator('#moneyPurchaseRows li').count(),1);
 await route('#money');assert.match(await page.locator('#moneyProjects').innerText(),/Christmas/);assert.equal(await page.locator('[data-total=planned]').innerText(),'£12.34');
 for(const hash of ['#money','#money-daily','#money-purchases']){await route(hash);for(const width of [320,350,390,430,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,hash+' '+width);}}
 await page.setViewportSize({width:390,height:844});await route('#money');await page.screenshot({path:path.join(artifacts,'hq-money-dashboard.png'),fullPage:true});
 await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>document.querySelector('[data-total=available]').textContent==='—');
 await page.locator('#moneySignIn').click();await page.locator('#email').fill('other@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await amount(),'£0.00');
 await page.locator('#menuToggle').click();if(!await page.locator('#logout').isVisible())await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.locator('#moneySignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await amount(),'£110.10');
 missing=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#moneyError').textContent.includes('not available yet'));assert.equal(await amount(),'—');assert.equal(await page.locator('[data-new-money=purchases]').isDisabled(),true);
 await page.locator('#homeLink').click();await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('.project').count(),6);
 await page.locator('#moneyLink').click();missing=false;await page.locator('#moneyReload').click();await ready();assert.equal(await amount(),'£110.10');
 assert.deepEqual(errors,[]);console.log('PASS Money Tracker: exact zero opening/balances, daily CRUD/duplicate dates, deposits/withdrawals, purchase state/actual price/reversal/delete, refresh/sign-in, filters, conflicts, failed saves/refresh, schema unavailable, mobile overflow and photos (mock Supabase).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
