const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'); const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const artifacts=process.env.TEST_ARTIFACTS || require('node:os').tmpdir();
const mock=`export function createClient(){let callback;return {auth:{getSession:async()=>({data:{session:localStorage.signedIn?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async()=>{localStorage.signedIn='1';return {error:null}},signOut:async()=>{delete localStorage.signedIn;callback?.('SIGNED_OUT');return {error:null}}},from(table){let q={table,op:'list'};const api={select:()=>api,order:()=>api,range:(a,b)=>{q.range=[a,b];return api},single:()=>{q.single=true;return api},insert:values=>{q.op='add';q.values=values;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},eq:(k,v)=>{q.id=v;return api},then:(resolve,reject)=>fetch('/__db',{method:'POST',body:JSON.stringify(q)}).then(r=>r.json()).then(resolve,reject)};return api}}}`;
(async()=>{
let rows=[{id:1,project:'Garden',task:'Undated garden task',completed:false,scheduled_date:null},{id:2,project:'Christmas Planning',task:'Wrap gifts',completed:false,scheduled_date:'2026-10-26'},{id:3,project:'Health & Fitness',task:'Walk',completed:true,scheduled_date:'2026-11-01'},{id:4,project:'Book Nook',task:'Book task',completed:false,scheduled_date:null}],next=5,failNext=false,zeroNext=false;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
try{
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/London'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.clock.install({time:new Date('2026-10-28T12:00:00Z')});
await page.route('https://esm.sh/**',r=>r.fulfill({contentType:'application/javascript',body:mock}));
await page.route('http://project.test/**',async route=>{
const url=new URL(route.request().url());
if(url.pathname==='/__db'){
const q=JSON.parse(route.request().postData());if(q.table!=='test_tasks')return route.fulfill({json:{error:{code:'PGRST205',message:'Routines not installed'}}});
if(failNext&&q.op!=='list'){failNext=false;return route.fulfill({json:{error:{message:'Test network failure'}}});}
if(zeroNext&&q.op==='update'){zeroNext=false;return route.fulfill({json:{data:null,error:{message:'No row returned'}}});}
let data;
if(q.op==='list')data=rows.slice(q.range[0],q.range[1]+1);
if(q.op==='add'){data={id:next++,completed:false,scheduled_date:null,...q.values};rows.push(data);}
if(q.op==='update'){const row=rows.find(r=>r.id===q.id);Object.assign(row,q.values);data=row;}
if(q.op==='delete'){data={id:q.id};rows=rows.filter(r=>r.id!==q.id);}
return route.fulfill({json:{data,error:null}});
}
try{const path=url.pathname==='/'?'/index.html':url.pathname;return route.fulfill({contentType:path.endsWith('.jpg')?'image/jpeg':path.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(root+path)});}catch{return route.fulfill({status:404,body:'Missing'});}
});
await page.goto('http://project.test/');await page.waitForFunction(()=>document.querySelectorAll('.project').length===6);
await page.locator('#weekLink').click();await page.waitForFunction(()=>!document.querySelector('#weekView').hidden);
assert.equal(await page.locator('#weekRange').innerText(),'26 Oct – 1 Nov 2026');assert.equal(await page.locator('.week-day').count(),7);assert.equal(await page.locator('.day-add:disabled').count(),7);
await page.locator('#weekSignIn').click();await page.locator('#email').fill('tester@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await page.waitForFunction(()=>document.querySelectorAll('.week-task').length===2);
assert.deepEqual(await page.locator('.week-day').evaluateAll(days=>days.map(d=>d.dataset.date)),['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
assert.equal(await page.locator('.is-today').getAttribute('data-date'),'2026-10-28');assert.equal(await page.locator('[data-date="2026-11-01"] .week-check input').isChecked(),true);
await page.locator('#previousWeek').click();assert.equal(await page.locator('#weekRange').innerText(),'19 Oct – 25 Oct 2026');await page.locator('#nextWeek').click();await page.locator('#nextWeek').click();assert.equal(await page.locator('#weekRange').innerText(),'2 Nov – 8 Nov 2026');await page.locator('#currentWeek').click();
for(let i=0;i<9;i++)await page.locator('#nextWeek').click();assert.equal(await page.locator('#weekRange').innerText(),'28 Dec 2026 – 3 Jan 2027');await page.locator('#currentWeek').click();
const editor=page.locator('#taskEditor');const save=editor.locator('button[type=submit]');
await page.locator('[data-date="2026-10-28"] .day-add').click();assert.equal(await page.locator('#plannerProject').inputValue(),'Other');assert.equal(await page.locator('#plannerDate').inputValue(),'2026-10-28');await page.locator('#plannerTask').fill('Buy flowers');await save.click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);
assert.equal(rows.find(r=>r.task==='Buy flowers').scheduled_date,'2026-10-28');assert.equal(rows.find(r=>r.task==='Buy flowers').project,'Other');
await page.locator('[data-date="2026-10-28"] .week-check input').check();await page.waitForFunction(()=>document.querySelector('[data-date="2026-10-28"] .week-task.done'));await page.locator('[data-date="2026-10-28"] .week-check input').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-date="2026-10-28"] .week-task.done'));
await page.getByRole('button',{name:'Edit Buy flowers',exact:true}).click();await page.locator('#plannerTask').fill('Buy tulips');await page.locator('#plannerDate').fill('2026-11-02');await save.click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);assert.equal(await page.locator('.week-task').count(),2);await page.locator('#nextWeek').click();assert.equal(await page.locator('.week-check span').innerText(),'Buy tulips');
await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.week-day').length===7);await page.locator('#nextWeek').click();await page.waitForFunction(()=>document.querySelectorAll('.week-task').length===1);assert.equal(await page.locator('.week-check span').innerText(),'Buy tulips');
await page.getByRole('button',{name:'Edit Buy tulips',exact:true}).click();failNext=true;await page.locator('#plannerTask').fill('Keep my edit');await save.click();await page.waitForFunction(()=>document.querySelector('#taskEditor [role=alert]').textContent.includes('Test network failure'));assert.equal(await page.locator('#plannerTask').inputValue(),'Keep my edit');assert.equal(rows.find(r=>r.project==='Other').task,'Buy tulips');
zeroNext=true;await save.click();await page.waitForFunction(()=>document.querySelector('#taskEditor [role=alert]').textContent.includes('No row'));await save.click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);
await page.getByRole('button',{name:'Edit Keep my edit',exact:true}).click();await page.locator('#plannerDate').fill('');await save.click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);assert.equal(rows.find(r=>r.project==='Other').scheduled_date,null);assert.equal(await page.locator('.week-task').count(),0);
await page.locator('#homeLink').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);await page.locator('.garden').click();assert.equal(await page.locator('#tasks .task-name').innerText(),'Undated garden task');await page.getByRole('button',{name:'Schedule Undated garden task',exact:true}).click();assert.equal(await page.locator('#plannerDate').inputValue(),'');await page.locator('#plannerDate').fill('2026-10-29');await save.click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);
await page.locator('#newTask').fill('New undated project task');await page.locator('#taskForm button').click();await page.waitForFunction(()=>document.querySelectorAll('#tasks li').length===2);assert.equal(rows.find(r=>r.task==='New undated project task').scheduled_date,null);
await page.locator('#tasks input').last().check();await page.waitForFunction(()=>document.querySelectorAll('#tasks .done').length===1);page.once('dialog',d=>d.accept());await page.locator('#tasks .delete').last().click();await page.waitForFunction(()=>document.querySelectorAll('#tasks li').length===1);
await page.locator('#weekLink').click();await page.locator('#currentWeek').click();await page.getByRole('button',{name:'Edit Undated garden task',exact:true}).click();page.once('dialog',d=>d.dismiss());await editor.locator('[data-delete]').click();assert.equal(await editor.getAttribute('open'),'');page.once('dialog',d=>d.accept());await editor.locator('[data-delete]').click();await page.waitForFunction(()=>!document.querySelector('#taskEditor').open);assert.ok(!rows.some(r=>r.id===1));
failNext=true;await page.locator('[data-date="2026-10-26"] input').check();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Test network failure'));assert.equal(await page.locator('[data-date="2026-10-26"] input').isChecked(),false);
for(const width of [320,350,375,390,430,600,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.week-day').count(),7);}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'hq-week.png'),fullPage:true});
await page.locator('#homeLink').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('.project').count(),6);await page.screenshot({path:path.join(artifacts,'hq-home.png'),fullPage:true});
await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>document.querySelector('#dashboard').hidden);await page.locator('#weekLink').click();assert.equal(await page.locator('.week-task').count(),0);assert.equal(await page.locator('.day-add:disabled').count(),7);
assert.deepEqual(errors,[]);assert.equal(rows.find(r=>r.id===4).scheduled_date,null);
console.log('PASS: week dates/navigation; existing scheduled and undated tasks; sign-in/out; add/edit/complete/uncomplete/delete/cancel; cross-week date moves; clear date; project scheduling and original task flows; reload persistence; mutation and zero-row errors; 320–1440px layout; six photos; no JS errors. Supabase client mocked.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
