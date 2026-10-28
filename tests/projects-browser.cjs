// Local fixtures only. Does not contact or write to the live Supabase database.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS || require('node:os').tmpdir();
const moduleCode=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},
 rpc:(name,args)=>send({op:'rpc',name,args}),from(table){const q={table,filters:[]};const api={select:()=>api,order:()=>api,range:()=>api,gte:()=>api,lte:()=>api,eq:(k,v)=>{q.filters.push([k,v]);return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const db={sections:[],milestones:[]};let missing=false,failBefore=false,failAfter=false,hold=null,reads=0,writes=0;
 const owner='owner@example.com';
 const snapshot=(user,project)=>{
  const data={sections:db.sections.filter(r=>r.owner_id===user&&r.project===project),milestones:db.milestones.filter(r=>r.owner_id===user&&r.project===project)};
  return {...data,revision:createHash('md5').update(JSON.stringify(data)).digest('hex')};
 };
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.route('https://esm.sh/**',route=>route.fulfill({contentType:'application/javascript',body:moduleCode}));
  await page.route('http://project.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname!=='/__db'){
    const file=pathname==='/'?'/index.html':pathname;
    return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html',body:fs.readFileSync(root+file)});
   }
   const q=JSON.parse(route.request().postData()),user=route.request().headers()['x-owner'];
   const reply=(data,error=null)=>route.fulfill({json:{data,error}});
   if(q.op!=='rpc')return reply(q.table==='test_tasks'?[{id:1,project:'Garden',task:'An ordinary task',completed:false,scheduled_date:null}]:[]);
   if(q.op==='rpc'&&q.name==='hq_coming_snapshot')return reply(null,{code:'PGRST202'});
   const {p_project:project,p_revision:revision,p_action:action,p_values:v}=q.args;
   if(missing)return reply(null,{code:'PGRST202'});
   if(q.name==='hq_project_snapshot'){reads++;return reply(snapshot(user,project));}
   assert.equal(q.name,'hq_project_change');writes++;if(hold)await hold;
   if(failBefore){failBefore=false;return reply(null,{message:'Test save failed'});}
   if(revision!==snapshot(user,project).revision)return reply(null,{code:'40001'});
   const inProject=r=>r.owner_id===user&&r.project===project;
   const section=()=>db.sections.find(r=>inProject(r)&&r.id===v.section_id);
   if(action==='save_section'){
    let row=db.sections.find(r=>inProject(r)&&r.id===v.id);
    if(row)row.name=v.name;else db.sections.push({id:v.id,name:v.name,owner_id:user,project,position:Math.max(-1,...db.sections.filter(inProject).map(r=>r.position))+1});
   }else if(action==='save_milestone'){
    assert.ok(section());let row=db.milestones.find(r=>inProject(r)&&r.id===v.id&&r.section_id===v.section_id);
    if(row)row.name=v.name;else db.milestones.push({id:v.id,name:v.name,owner_id:user,project,section_id:v.section_id,completed:false,position:Math.max(-1,...db.milestones.filter(r=>inProject(r)&&r.section_id===v.section_id).map(r=>r.position))+1});
   }else if(action==='complete_milestone'){
    assert.ok(section());const row=db.milestones.find(r=>inProject(r)&&r.id===v.id&&r.section_id===v.section_id);assert.ok(row);row.completed=v.completed;
   }else if(action==='delete_section'){
    assert.ok(db.sections.some(r=>inProject(r)&&r.id===v.id));db.sections=db.sections.filter(r=>!(inProject(r)&&r.id===v.id));db.milestones=db.milestones.filter(r=>!(inProject(r)&&r.section_id===v.id));
   }else if(action==='delete_milestone'){
    assert.ok(section());db.milestones=db.milestones.filter(r=>!(inProject(r)&&r.id===v.id&&r.section_id===v.section_id));
   }else if(action==='order_sections'||action==='order_milestones'){
    const rows=(action==='order_sections'?db.sections:db.milestones).filter(r=>inProject(r)&&(action==='order_sections'||r.section_id===v.section_id));
    assert.equal(new Set(v.ids).size,rows.length);assert.deepEqual([...v.ids].sort(),rows.map(r=>r.id).sort());v.ids.forEach((id,index)=>{rows.find(r=>r.id===id).position=index;});
   }else throw Error('Unknown action');
   if(failAfter){failAfter=false;return reply(null,{message:'Response interrupted'});}
   return reply(snapshot(user,project));
  });
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#projectAddSection').disabled);
  const editor=page.locator('#projectEditor');
  const save=async()=>{await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#projectEditor').open);await ready();};
  const add=async(kind,name)=>{await page.locator(kind==='section'?'#projectAddSection':'#projectAddMilestone').click();await page.locator('#projectEntryName').fill(name);await save();};
  const go=async(project)=>{await page.evaluate(hash=>location.hash=hash,'#project/'+encodeURIComponent(project));await ready();};
  const openSection=async(name)=>{await page.locator('.project-section-link').filter({has:page.getByRole('heading',{name,exact:true})}).click();await page.waitForFunction(()=>!document.querySelector('#projectSectionContent').hidden);};
  const overall=()=>page.locator('#projectOverall [role=progressbar]').getAttribute('aria-valuenow');
  const sectionProgress=()=>page.locator('#projectSectionProgress [role=progressbar]').getAttribute('aria-valuenow');
  await page.goto('http://project.test/');await page.locator('.garden').tap();await page.waitForFunction(()=>!document.querySelector('#projectView').hidden);
  assert.equal(await page.locator('#projectHeading').innerText(),'Garden');assert.equal(await page.locator('#projectAddSection').isDisabled(),true);
  await page.locator('#projectSignIn').tap();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await overall(),'0');assert.match(await page.locator('#projectOverall').innerText(),/Not started/);
  await add('section','First area');await add('section','Second area');
  await page.getByRole('button',{name:'Move Second area up',exact:true}).tap();await ready();assert.deepEqual(await page.locator('.project-section-link h3').allTextContents(),['Second area','First area']);
  await page.reload();await ready();assert.deepEqual(await page.locator('.project-section-link h3').allTextContents(),['Second area','First area']);
  await page.getByRole('button',{name:'Rename First area',exact:true}).tap();await page.locator('#projectEntryName').fill('A new area');await save();
  await openSection('A new area');assert.match(await page.locator('#projectSectionProgress').innerText(),/Not started/);
  await add('milestone','First step');await add('milestone','Second step');
  let release;hold=new Promise(resolve=>release=resolve);await page.getByLabel('First step',{exact:true}).check();
  await page.waitForFunction(()=>document.querySelector('#projectStatus').textContent==='Saving…');assert.equal(await sectionProgress(),'50');assert.equal(await overall(),'50');release();hold=null;await ready();
  await page.getByLabel('First step',{exact:true}).uncheck();await ready();assert.equal(await overall(),'0');await page.getByLabel('First step',{exact:true}).check();await ready();
  await page.getByRole('button',{name:'Move milestone Second step up',exact:true}).tap();await ready();assert.deepEqual(await page.locator('.project-milestone-label span').allTextContents(),['Second step','First step']);
  await page.getByRole('button',{name:'Rename milestone Second step',exact:true}).click();await page.locator('#projectEntryName').fill('An edited step');await save();
  await page.reload();await ready();assert.equal(await page.getByLabel('First step',{exact:true}).isChecked(),true);assert.deepEqual(await page.locator('.project-milestone-label span').allTextContents(),['An edited step','First step']);assert.equal(await sectionProgress(),'50');
  await page.locator('#projectBack').tap();await openSection('Second area');await add('milestone','Third step');assert.equal(await overall(),'33');assert.equal(await sectionProgress(),'0');
  await go('Other');await add('section','Independent area');await openSection('Independent area');await add('milestone','Independent step');await page.getByLabel('Independent step',{exact:true}).check();await ready();assert.equal(await overall(),'100');
  await go('Garden');await openSection('A new area');
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete milestone An edited step',exact:true}).tap();assert.equal(await page.locator('.project-milestone').count(),2);
  page.once('dialog',d=>{assert.match(d.message(),/only this milestone/);return d.accept();});await page.getByRole('button',{name:'Delete milestone An edited step',exact:true}).tap();await ready();assert.equal(await overall(),'50');assert.equal(await sectionProgress(),'100');
  await page.locator('#projectRenameSection').click();await page.locator('#projectEntryName').fill('A very long custom subsection name '+ 'wide words '.repeat(12));await save();
  for(const width of [320,350,375,390,430,600,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'hq-project-subsection.png'),fullPage:true});
  page.once('dialog',d=>d.dismiss());await page.locator('#projectDeleteSection').tap();assert.equal(db.sections.filter(r=>r.project==='Garden').length,2);
  page.once('dialog',d=>{assert.match(d.message(),/its 1 milestone\?/);assert.match(d.message(),/Other subsections, projects and planner tasks/);return d.accept();});await page.locator('#projectDeleteSection').tap();await page.waitForFunction(()=>document.querySelector('#projectSectionPage').hidden);await ready();assert.equal(await page.locator('.project-section-card').count(),1);assert.equal(db.milestones.filter(r=>r.project==='Garden').length,1);assert.equal(db.milestones.filter(r=>r.project==='Other').length,1);assert.equal(await overall(),'0');
  await page.screenshot({path:path.join(artifacts,'hq-project-dashboard.png'),fullPage:true});
  // Stale changes and uncertain committed responses require a fresh snapshot.
  await page.getByRole('button',{name:'Rename Second area',exact:true}).click();db.sections.find(r=>r.project==='Garden').name='Edited elsewhere';await page.locator('#projectEntryName').fill('Stale name');await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#projectEditor [role=alert]').textContent.includes('another session'));assert.equal(db.sections.find(r=>r.project==='Garden').name,'Edited elsewhere');await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#projectReload').click();await ready();
  await page.locator('#projectAddSection').click();await page.locator('#projectEntryName').fill('Keep my text');failBefore=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#projectEditor [role=alert]').textContent.includes('Test save failed'));assert.equal(await page.locator('#projectEntryName').inputValue(),'Keep my text');assert.equal(await editor.locator('[type=submit]').isDisabled(),true);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#projectReload').click();await ready();
  await page.locator('#projectAddSection').click();await page.locator('#projectEntryName').fill('Saved despite interruption');failAfter=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#projectEditor [role=alert]').textContent.includes('Response interrupted'));assert.equal(db.sections.filter(r=>r.name==='Saved despite interruption').length,1);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#projectReload').click();await ready();assert.equal(await page.locator('.project-section-card').count(),2);
  // All six headers reuse the exact photographs and existing project keys.
  const projects=[['Garden','garden.jpg'],['Book Nook','book-nook.jpg'],['Christmas Planning','christmas.jpg'],['Health & Fitness','wellbeing.jpg'],['Home Projects','home-projects.jpg'],['Other','other.jpg']];
  for(const [project,image] of projects){await go(project);assert.match(await page.locator('#projectPhoto').getAttribute('src'),new RegExp(image.replace('.','\\.')));await page.waitForFunction(()=>document.querySelector('#projectPhoto').complete&&document.querySelector('#projectPhoto').naturalWidth>0);}
  await go('Garden');await page.locator('#projectTasks').click();assert.equal(await page.locator('#tasks .task-name').innerText(),'An ordinary task');
  await go('Other');assert.equal(await overall(),'100');await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#projectSignIn').hidden);assert.equal(await page.locator('.project-section-card').count(),0);assert.equal(await page.locator('#projectOverall').isHidden(),true);
  await page.locator('#projectSignIn').click();await page.locator('#email').fill('second@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await page.locator('.project-section-card').count(),0);assert.match(await page.locator('#projectOverall').innerText(),/Not started/);
  await page.locator('#menuToggle').click();await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.locator('#projectSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();assert.equal(await overall(),'100');
  missing=true;const previousReads=reads;await page.evaluate(()=>location.hash='#project/Book%20Nook');await page.waitForFunction(()=>document.querySelector('#projectError').textContent.includes('migration'));assert.equal(await page.locator('#projectAddSection').isDisabled(),true);assert.equal(reads,previousReads);
  missing=false;await page.locator('#projectReload').click();await ready();assert.match(await page.locator('#projectOverall').innerText(),/Not started/);
  await page.locator('#homeLink').click();await page.waitForFunction(()=>!document.querySelector('#homeView').hidden);await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth));assert.equal(await page.locator('.project').count(),6);
  assert.deepEqual(errors,[]);assert.ok(reads>0&&writes>0);
  console.log('PASS: all six dashboards/images; sign-in isolation; subsection and milestone CRUD; touch reorder; immediate weighted progress; no milestones; deletion confirmation/cascade isolation; refresh/sign-in persistence; stale/failed/uncertain saves; missing migration recovery; 320–1440px layouts. Supabase mocked; no live database writes.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
