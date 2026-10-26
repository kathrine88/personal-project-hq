// Local fixtures only: no live Supabase requests, writes or external metadata service.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS||require('node:os').tmpdir();
const clientModule=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},rpc:(name,args)=>send({op:'rpc',name,args}),
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:()=>api,gte:()=>api,lte:()=>api,single:()=>{q.single=true;return api},maybeSingle:()=>{q.single=true;return api},eq:(k,v)=>{q.filters.push([k,v]);return api},upsert:(values,options)=>{q.op='upsert';q.values=values;q.options=options;return api},update:values=>{q.op='update';q.values=values;return api},delete:()=>{q.op='delete';return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const owner='owner@example.com',first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
 const db={sources:[],sections:[{id:first,project:'Garden',owner_id:owner,name:'First area',position:0},{id:second,project:'Garden',owner_id:owner,name:'Second area',position:1},{id:other,project:'Other',owner_id:owner,name:'Other area',position:0}],milestones:[{id:'m1',owner_id:owner,project:'Garden',section_id:first,name:'Unchanged milestone',completed:true,position:0}]};
 let missing=false,failBefore=false,failLoad=false,failAfterSave=false,failAfterCommit=false,writes=0;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/London'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('request',r=>requests.push(r.url()));
 await page.route('https://esm.sh/**',route=>route.fulfill({contentType:'application/javascript',body:clientModule}));
 await page.route('https://preview.public-site.org/**',route=>route.request().url().endsWith('missing.jpg')?route.fulfill({status:404,body:'Missing'}):route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(root+'/images/book-nook.jpg')}));
 await page.route('http://project.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname!=='/__db'){const file=pathname==='/'?'/index.html':pathname;return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html',body:fs.readFileSync(root+file)});}
  const q=JSON.parse(route.request().postData()),user=route.request().headers()['x-owner'],reply=(data,error=null)=>route.fulfill({json:{data,error}});
  const scoped=(r,project)=>r.owner_id===user&&r.project===project;
  const snapshot=project=>({sections:db.sections.filter(r=>scoped(r,project)),sources:db.sources.filter(r=>scoped(r,project))});
  const projectSnapshot=project=>({sections:db.sections.filter(r=>scoped(r,project)),milestones:db.milestones.filter(r=>scoped(r,project)),revision:'fixture'});
  if(q.op==='rpc'){
   if(q.name==='hq_source_library'){
    if(missing)return reply(null,{code:'PGRST202'});if(failLoad){failLoad=false;return reply(null,{message:'Test reload failed'});}return reply(snapshot(q.args.p_project));
   }
   if(q.name==='hq_project_snapshot')return reply(projectSnapshot(q.args.p_project));
   if(q.name==='hq_project_change'){
    assert.equal(q.args.p_action,'delete_section');const project=q.args.p_project,id=q.args.p_values.id;
    db.sections=db.sections.filter(r=>!(scoped(r,project)&&r.id===id));db.milestones=db.milestones.filter(r=>!(scoped(r,project)&&r.section_id===id));
    db.sources.filter(r=>scoped(r,project)&&r.section_id===id).forEach(r=>{r.section_id=null;r.version++;r.updated_at='2026-10-26T16:01:00Z';});return reply(projectSnapshot(project));
   }
   throw Error('Unexpected RPC '+q.name);
  }
  if(q.table!=='hq_project_sources')return reply([]);
  const matches=row=>row.owner_id===user&&q.filters.every(([k,v])=>row[k]===v);
  if(q.op==='list'){const rows=db.sources.filter(matches);return reply(q.single?(rows[0]||null):rows);}
  writes++;if(failBefore){failBefore=false;return reply(null,{message:'Test save failed'});}
  if(q.values?.section_id&&!db.sections.some(s=>s.id===q.values.section_id&&scoped(s,q.values.project||db.sources.find(r=>r.owner_id===user&&r.id===q.filters.find(([k])=>k==='id')?.[1])?.project)))return reply(null,{code:'23503'});
  if(q.op==='upsert'){
   assert.equal(q.options.ignoreDuplicates,true);if(db.sources.some(r=>r.id===q.values.id))return reply(null);
   const row={owner_id:user,version:1,preview_image_url:null,created_at:'2026-10-26T15:00:00Z',updated_at:'2026-10-26T15:00:00Z',...q.values};db.sources.push(row);
   if(failAfterSave){failAfterSave=false;failLoad=true;}if(failAfterCommit){failAfterCommit=false;return reply(null,{message:'Response interrupted'});}return reply(row);
  }
  const row=db.sources.find(matches);if(!row)return reply(null,{code:'PGRST116'});
  if(q.op==='update'){Object.assign(row,q.values,{version:row.version+1,updated_at:'2026-10-26T16:00:00Z'});return reply(row);}
  if(q.op==='delete'){db.sources=db.sources.filter(r=>r!==row);return reply({id:row.id});}
 });
 const editor=page.locator('#sourceEditor'),name=key=>editor.locator('[name="'+key+'"]');
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#sourceAdd').disabled);
 const save=async()=>{await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#sourceEditor').open);await ready();};
 const go=async project=>{await page.evaluate(project=>location.hash='#library/'+encodeURIComponent(project),project);await ready();};
 const back=async()=>{await page.locator('#sourceBackToLibrary').tap();await page.waitForFunction(()=>!document.querySelector('#sourceCollection').hidden);await ready();};
 const detail=async title=>{await page.locator('.source-open').filter({has:page.getByRole('heading',{name:title,exact:true})}).tap();await page.waitForFunction(()=>!document.querySelector('#sourceDetailContent').hidden);};
 const addLink=async(url,title='')=>{await page.locator('#sourceAdd').tap();await name('url').fill(url);if(title)await name('title').fill(title);await save();};
 const signIn=async email=>{await page.locator('#email').fill(email);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();};
 await page.goto('http://project.test/');await page.locator('.garden').tap();await page.waitForFunction(()=>!document.querySelector('#projectView').hidden);await page.locator('#projectLibrary').tap();await page.waitForFunction(()=>!document.querySelector('#sourceView').hidden);assert.equal(await page.locator('#sourceAdd').isDisabled(),true);
 await page.locator('#sourceSignIn').tap();await signIn(owner);await ready();assert.match(await page.locator('#sourceEmpty').innerText(),/A home for your ideas/);
 await page.locator('#sourceAdd').tap();assert.equal(await page.locator('#sourceMoreDetails').getAttribute('open'),null);await name('url').fill('https://example.org/a');await save();assert.equal(db.sources.length,1);assert.equal(db.sources[0].title,'example.org');assert.equal(db.sources[0].section_id,null);
 await detail('example.org');assert.equal(await page.locator('#sourceOriginal').getAttribute('href'),'https://example.org/a');assert.equal(await page.locator('#sourceOriginal').getAttribute('rel'),'noopener noreferrer');
 await page.locator('#sourceEdit').tap();await name('title').fill('Useful garden reference');await name('description').fill('A useful reference for the project.');await name('notes').fill('Remember this idea.\nSecond line.');await name('section_id').selectOption(first);await save();assert.equal(await page.locator('#sourceDetailNotes').innerText(),'Remember this idea.\nSecond line.');assert.equal(await page.locator('#sourceDetailSection').innerText(),'First area');
 await back();await page.locator('#sourceAdd').tap();await name('source_type').selectOption('note');await name('title').fill('A written plan');await name('content').fill('First thought\n\nAnother paragraph with <script>never execute</script>.');await page.locator('#sourceMoreDetails summary').tap();await name('section_id').selectOption(second);await save();assert.equal(db.sources.length,2);assert.equal(db.sources[1].source_type,'note');assert.equal(db.sources[1].url,null);
 await addLink('http://example.net/reference','Another reference');
 await page.locator('#sourceTypeFilter').selectOption('note');assert.equal(await page.locator('.source-card').count(),1);await page.locator('#sourceTypeFilter').selectOption('link');assert.equal(await page.locator('.source-card').count(),2);
 await page.locator('#sourceSectionFilter').selectOption(first);assert.equal(await page.locator('.source-card').count(),1);await page.locator('#sourceSectionFilter').selectOption('unassigned');assert.equal(await page.locator('.source-card').count(),1);
 await page.locator('#sourceTypeFilter').selectOption('note');assert.match(await page.locator('#sourceEmpty').innerText(),/No matching sources/);await page.locator('#sourceClearFilters').tap();assert.equal(await page.locator('.source-card').count(),3);
 await page.locator('[data-source-view=list]').tap();assert.equal(await page.locator('#sourceRows').getAttribute('class'),'source-rows is-list');await page.reload();await ready();assert.equal(await page.locator('[data-source-view=list]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.source-card').count(),3);
 await detail('A written plan');assert.match(await page.locator('#sourceDetailNotes').innerText(),/<script>never execute<\/script>/);assert.equal(await page.locator('#sourceOriginal').isHidden(),true);await page.locator('#sourceEdit').tap();await name('title').fill('An edited written plan');await name('content').fill('Updated full written note.\nStill separate from tasks.');await name('section_id').selectOption('');await save();assert.equal(await page.locator('#sourceDetailSection').innerText(),'No subsection');await page.reload();await ready();assert.match(await page.locator('#sourceDetailNotes').innerText(),/Updated full written note/);
 await back();await page.locator('[data-source-view=gallery]').tap();
 // Preview rendering is supported when trusted metadata exists; failing images fall back.
 db.sources.find(r=>r.title==='Useful garden reference').preview_image_url='https://preview.public-site.org/card.jpg';db.sources.find(r=>r.title==='Another reference').preview_image_url='https://preview.public-site.org/missing.jpg';
 await page.locator('#sourceReload').tap();await ready();await page.waitForFunction(()=>document.querySelectorAll('.source-media img').length===1&&document.querySelector('.source-media img').naturalWidth>0);
 assert.equal(await page.locator('.source-media-symbol').count(),3);await detail('Useful garden reference');assert.equal(await page.locator('#sourceDetailImage').isHidden(),false);await back();
 for(const width of [320,350,375,390,430,600,768,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'hq-source-gallery.png'),fullPage:true});await page.locator('[data-source-view=list]').tap();await page.screenshot({path:path.join(artifacts,'hq-source-list.png'),fullPage:true});
 // Each project gets its own library; unassigned is optional and is the default.
 await go('Other');assert.equal(await page.locator('.source-card').count(),0);await addLink('https://other-site.org/','Independent source');await go('Garden');assert.equal(await page.locator('.source-card').count(),3);
 // An in-flight edit cannot overwrite another tab's changed version.
 await detail('Useful garden reference');await page.locator('#sourceEdit').tap();db.sources.find(r=>r.title==='Useful garden reference').version++;await name('title').fill('Stale edit');await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('changed or deleted'));assert.equal(db.sources.find(r=>r.title==='Stale edit'),undefined);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#sourceReload').tap();await ready();
 // Saving failures preserve text and require reload rather than duplicate retries.
 await back();await page.locator('#sourceAdd').tap();await name('url').fill('https://failed-save.org/');failBefore=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('Test save failed'));assert.equal(await name('url').inputValue(),'https://failed-save.org/');assert.equal(await editor.locator('[type=submit]').isDisabled(),true);await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#sourceReload').tap();await ready();
 await page.locator('#sourceAdd').tap();await name('url').fill('https://committed.org/');failAfterSave=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#sourceEditor').open);assert.match(await page.locator('#sourceError').innerText(),/Saved, but/);assert.equal(await page.locator('#sourceAdd').isDisabled(),true);assert.equal(db.sources.filter(r=>r.url==='https://committed.org/').length,1);await page.locator('#sourceReload').tap();await ready();
 await page.locator('#sourceAdd').tap();await name('url').fill('https://uncertain.org/');failAfterCommit=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('Response interrupted'));await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#sourceReload').tap();await ready();assert.equal(db.sources.filter(r=>r.url==='https://uncertain.org/').length,1);
 // Deleting a subsection keeps assigned sources and unassigns only matching rows.
 await page.locator('#sourceProjectBack').tap();await page.waitForFunction(()=>!document.querySelector('#projectAddSection').disabled);assert.equal(await page.locator('#projectOverall [role=progressbar]').getAttribute('aria-valuenow'),'100');
 page.once('dialog',d=>{assert.match(d.message(),/sources assigned here will be kept/);return d.accept();});await page.getByRole('button',{name:'Delete subsection First area',exact:true}).tap();await page.waitForFunction(()=>document.querySelectorAll('.project-section-card').length===1);assert.equal(db.sources.find(r=>r.title==='Useful garden reference').section_id,null);assert.equal(db.sources.find(r=>r.title==='Independent source').project,'Other');await page.locator('#projectLibrary').tap();await ready();await detail('Useful garden reference');assert.equal(await page.locator('#sourceDetailSection').innerText(),'No subsection');
 page.once('dialog',d=>d.dismiss());await page.locator('#sourceDelete').tap();assert.ok(db.sources.some(r=>r.title==='Useful garden reference'));
 page.once('dialog',d=>{assert.match(d.message(),/only this saved source/);return d.accept();});await page.locator('#sourceDelete').tap();await page.waitForFunction(()=>!document.querySelector('#sourceCollection').hidden);await ready();assert.ok(!db.sources.some(r=>r.title==='Useful garden reference'));
 // iPhone form layout and note details: long text wraps without horizontal overflow.
 await detail('An edited written plan');await page.locator('#sourceEdit').tap();await name('title').fill('An edited written plan');await name('content').fill('A long single word: '+ 'a'.repeat(700));await save();await page.screenshot({path:path.join(artifacts,'hq-source-detail.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#sourceEdit').tap();for(const width of [320,375,390]){await page.setViewportSize({width,height:844});assert.equal(await editor.evaluate(e=>e.scrollWidth>e.clientWidth),false);}await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.setViewportSize({width:390,height:844});
 // A deleted association in an open form is refused, not attached elsewhere.
 await back();await page.locator('#sourceAdd').tap();await name('url').fill('https://old-subsection.org/');await page.locator('#sourceMoreDetails summary').tap();await name('section_id').selectOption(second);db.sections=db.sections.filter(s=>s.id!==second);await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('subsection'));await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#sourceReload').tap();await ready();
 // Library selection defaults to all when entering a new project, uses exact existing keys.
 for(const project of ['Garden','Book Nook','Christmas Planning','Health & Fitness','Home Projects','Other']){await go(project);assert.equal(await page.locator('#sourceTypeFilter').inputValue(),'');assert.equal(await page.locator('#sourceSectionFilter').inputValue(),'');assert.ok((await page.locator('#sourceProjectBack').getAttribute('href')).startsWith('#project/'));}
 await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#sourceSignIn').hidden);assert.equal(await page.locator('.source-card').count(),0);
 await page.locator('#sourceSignIn').tap();await signIn('second@example.com');await ready();assert.equal(await page.locator('.source-card').count(),0);
 await page.locator('#logout').click();await page.locator('#sourceSignIn').tap();await signIn(owner);await ready();assert.equal(await page.locator('.source-card').count(),1);
 missing=true;await page.evaluate(()=>location.hash='#library/Book%20Nook');await page.waitForFunction(()=>document.querySelector('#sourceError').textContent.includes('Stage 2A'));assert.equal(await page.locator('#sourceAdd').isDisabled(),true);missing=false;await page.locator('#sourceReload').tap();await ready();assert.equal(await page.locator('.source-card').count(),0);
 await page.locator('#homeLink').click();await page.waitForFunction(()=>[...document.querySelectorAll('.project img')].every(i=>i.complete&&i.naturalWidth));assert.equal(await page.locator('.project').count(),6);
 assert.ok(!requests.some(url=>/example\.org|example\.net|failed-save\.org|committed\.org|uncertain\.org/.test(url)),'No cross-origin metadata fetches are attempted');assert.deepEqual(errors,[]);assert.ok(writes>0);
 console.log('PASS Source Library: all project routes; URL-only save; link/note CRUD and details; combined filters; view memory; optional/deleted subsection scope; stale edits; failed/uncertain writes and refresh; sign-in isolation/persistence; supported/broken previews; safe text; no metadata fetches; mobile layouts. Supabase mocked; no live DB writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
