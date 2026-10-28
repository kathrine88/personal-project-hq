// UI persistence/storage fixtures only; never uses a live bucket or database.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=process.env.TEST_ARTIFACTS||require('node:os').tmpdir();
const moduleCode=`export function createClient(){let callback;const send=q=>fetch('/__db',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(q)}).then(r=>r.json());return {
 auth:{getSession:async()=>({data:{session:localStorage.user?{}:null}}),onAuthStateChange:fn=>callback=fn,signInWithPassword:async({email})=>{localStorage.user=email;return {error:null}},signOut:async()=>{delete localStorage.user;callback?.('SIGNED_OUT');return {error:null}}},rpc:(name,args)=>send({op:'rpc',name,args}),
 functions:{invoke:async(name,{body})=>{let payload=body;if(body instanceof FormData){const f=body.get('file');payload={upload:true,metadata:JSON.parse(body.get('metadata')),file:{name:f.name,type:f.type,bytes:[...new Uint8Array(await f.arrayBuffer())]}};}const r=await fetch('/__files',{method:'POST',headers:{'x-owner':localStorage.user||''},body:JSON.stringify(payload)});const data=await r.json();return r.ok?{data,error:null}:{data:null,error:{context:{json:async()=>data}}};}},
 storage:{from:bucket=>({createSignedUrl:async(path,seconds,options)=>send({op:'sign',bucket,path,seconds,options})})},
 from(table){const q={table,op:'list',filters:[]};const api={select:()=>api,order:()=>api,range:()=>api,gte:()=>api,lte:()=>api,single:()=>{q.single=true;return api},maybeSingle:()=>{q.single=true;return api},eq:(k,v)=>{q.filters.push([k,v]);return api},update:values=>{q.op='update';q.values=values;return api},then:(ok,bad)=>send(q).then(ok,bad)};return api;}}}`;
(async()=>{
 const {validateFile}=await import('../supabase/functions/source-files/index.ts');
 const owner='owner@example.com',uid='00000000-0000-4000-8000-000000000001',section='00000000-0000-4000-8000-000000000002';
 const db={sources:[],sections:[{id:section,owner_id:owner,project:'Garden',name:'First area',position:0}]},objects=new Map(),cleanup=[];
 let uploadCount=0,signCount=0,expiredFirst=true,failUpload=false,failCommit=false,failCleanup=false,failDelete=false,unavailable=false,hold=null;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Europe/London'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('request',r=>requests.push(r.url()));
 await page.route('https://esm.sh/**',r=>r.fulfill({contentType:'application/javascript',body:moduleCode}));
 await page.route('https://rilqlmsojlplbaoxkztc.supabase.co/storage/v1/object/sign/**',route=>{
  const url=new URL(route.request().url()),key=url.pathname.split('/hq-source-files/')[1],file=objects.get(key);
  if(url.searchParams.get('token')==='expired'||!file)return route.fulfill({status:403,body:'Expired'});
  return route.fulfill({contentType:file.mime,headers:url.searchParams.has('download')?{'Content-Disposition':'attachment; filename="download"'}:{},body:file.bytes});
 });
 await page.route('http://project.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname,user=route.request().headers()['x-owner'];
  if(pathname==='/__files'){
   const reply=(data,status=200)=>route.fulfill({json:data,status});if(unavailable)return reply({error:'Complete Stage 2B setup before uploading.'},503);
   const payload=JSON.parse(route.request().postData());
   if(payload.upload){
    uploadCount++;if(hold)await hold;
    const file=new File([new Uint8Array(payload.file.bytes)],payload.file.name,{type:payload.file.type}),v=payload.metadata;
    if(failUpload){failUpload=false;return reply({error:'Test upload failed'},503);}
    let meta;try{meta=validateFile(new Uint8Array(await file.arrayBuffer()),file.name,v.source_type);}catch(e){return reply({error:e.message},400);}
    let row=db.sources.find(r=>r.owner_id===user&&r.project===v.project&&r.id===v.id);
    if(v.version!=null&&(!row||row.version!==v.version))return reply({error:'Source changed. Reload before replacing.'},409);
    if(v.section_id&&!db.sections.some(s=>s.id===v.section_id&&s.owner_id===user&&s.project===v.project))return reply({error:'Subsection not found'},400);
    const key=uid+'/'+v.id+'/'+v.operation+'.'+meta.extension;objects.set(key,{mime:meta.mime_type,bytes:Buffer.from(await file.arrayBuffer())});
    if(failCommit){failCommit=false;objects.delete(key);return reply({error:'Test source creation failed; uploaded file cleaned.'},400);}
    const old=row?.storage_path;
    if(row)Object.assign(row,v,meta,{storage_path:key,version:row.version+1});
    else {row={...v,...meta,owner_id:user,storage_path:key,file_status:'ready',version:1,created_at:'2026-10-26T17:00:00Z',updated_at:'2026-10-26T17:00:00Z'};db.sources.push(row);}
    if(old){if(failCleanup){failCleanup=false;cleanup.push({path:old,project:v.project,owner_id:user});}else objects.delete(old);}
    return reply({saved:true});
   }
   const v=JSON.parse(route.request().postData());
   if(v.action==='cleanup'){
    for(let i=cleanup.length-1;i>=0;i--)if(cleanup[i].owner_id===user&&cleanup[i].project===v.project){objects.delete(cleanup[i].path);if(cleanup[i].id)db.sources=db.sources.filter(s=>s.id!==cleanup[i].id);cleanup.splice(i,1);}
    return reply({notice:'File cleanup checked.'});
   }
   assert.equal(v.action,'delete');const row=db.sources.find(r=>r.id===v.id&&r.owner_id===user&&r.project===v.project);assert.ok(row);assert.equal(row.version,v.version);
   if(failDelete){failDelete=false;objects.delete(row.storage_path);row.file_status='deleting';row.version++;cleanup.push({path:row.storage_path,id:row.id,owner_id:user,project:row.project});return reply({error:'Deletion is pending. Reload and retry file cleanup.'},503);}
   objects.delete(row.storage_path);db.sources=db.sources.filter(r=>r!==row);return reply({deleted:true});
  }
  if(pathname==='/__db'){
   const q=JSON.parse(route.request().postData()),reply=(data,error=null)=>route.fulfill({json:{data,error}});
   if(q.op==='sign'){
    assert.equal(q.bucket,'hq-source-files');assert.equal(q.seconds,300);signCount++;
    const source=db.sources.find(r=>r.owner_id===user&&r.storage_path===q.path&&r.file_status==='ready');if(!source)return reply(null,{message:'Access denied'});
    const token=expiredFirst?'expired':'valid-'+signCount;expiredFirst=false;
    return reply({signedUrl:'https://rilqlmsojlplbaoxkztc.supabase.co/storage/v1/object/sign/hq-source-files/'+q.path+'?token='+token+(q.options?.download?'&download='+encodeURIComponent(q.options.download):'')});
   }
   if(q.op==='rpc'){
    if(q.name==='hq_coming_snapshot')return route.fulfill({json:{data:null,error:{code:'PGRST202'}}});
    assert.equal(q.name,'hq_source_library');return reply({sources:db.sources.filter(r=>r.owner_id===user&&r.project===q.args.p_project),sections:db.sections.filter(r=>r.owner_id===user&&r.project===q.args.p_project),file_cleanup_pending:cleanup.some(r=>r.owner_id===user&&r.project===q.args.p_project)});
   }
   if(q.table!=='hq_project_sources')return reply([]);
   assert.equal(q.op,'update');const row=db.sources.find(r=>r.owner_id===user&&q.filters.every(([k,v])=>r[k]===v));if(!row)return reply(null,{code:'PGRST116'});assert.ok(!('storage_path' in q.values));Object.assign(row,q.values,{version:row.version+1});return reply(row);
  }
  const file=pathname==='/'?'/index.html':pathname;return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'text/html',body:fs.readFileSync(root+file)});
 });
 const editor=page.locator('#sourceEditor'),field=name=>editor.locator('[name="'+name+'"]');
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#sourceAdd').disabled);
 const save=async()=>{await editor.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#sourceEditor').open).catch(async e=>{console.error('EDITOR',await editor.innerText());throw e;});await ready();};
 const openAdd=async kind=>{await page.locator('#sourceAdd').tap();await field('source_type').selectOption(kind);};
 const back=async()=>{await page.locator('#sourceBackToLibrary').click();await page.waitForFunction(()=>!document.querySelector('#sourceCollection').hidden);await ready();};
 const detail=async title=>{await page.locator('.source-open').filter({has:page.getByRole('heading',{name:title,exact:true})}).tap();await page.waitForFunction(()=>!document.querySelector('#sourceDetailContent').hidden);};
 const cancelReload=async()=>{await editor.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#sourceReload').click();await ready();};
 await page.goto('http://project.test/#library/Garden');await page.locator('#sourceSignIn').click();await page.locator('#email').fill(owner);await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();
 await openAdd('image');await field('upload').setInputFiles(root+'/images/garden.jpg');assert.match(await page.locator('#sourceSelectedFile').innerText(),/garden.jpg/);await page.waitForFunction(()=>document.querySelector('#sourceSelectedPreview').naturalWidth>0);
 for(const width of [320,375,390]){await page.setViewportSize({width,height:844});assert.equal(await editor.evaluate(e=>e.scrollWidth>e.clientWidth),false);}
 await page.screenshot({path:path.join(artifacts,'hq-upload-form.png'),fullPage:true});
 let release;hold=new Promise(r=>release=r);await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [type=submit]').textContent.includes('Uploading'));assert.equal(await editor.locator('[data-cancel]').isDisabled(),true);assert.equal(await editor.locator('[type=submit]').isDisabled(),true);assert.equal(db.sources.length,0);release();hold=null;await page.waitForFunction(()=>!document.querySelector('#sourceEditor').open).catch(async e=>{console.error('EDITOR',await editor.innerText());throw e;});await ready();assert.equal(uploadCount,1);assert.equal(objects.size,1);
 await page.waitForFunction(()=>document.querySelector('.source-media img')?.naturalWidth>0);assert.ok(signCount>=2,'Expired image URL refreshed');
 await detail('garden.jpg');await page.waitForFunction(()=>document.querySelector('#sourceFileDownload').href.includes('download='));assert.match(await page.locator('#sourceFileDownload').getAttribute('href'),/download=garden.jpg/);assert.equal(await page.locator('#sourceFileOpen').getAttribute('target'),'_blank');
 const signBefore=signCount;await page.locator('#sourceRefreshFile').click();await page.waitForFunction(()=>document.querySelector('#sourceFileDownload').href.includes('download='));assert.ok(signCount>signBefore);
 await page.locator('#sourceEdit').click();await field('title').fill('Garden inspiration');await page.locator('#sourceMoreDetails').evaluate(e=>e.open=true);await field('description').fill('A photograph for the garden.');await field('notes').fill('Keep these ideas.');await field('section_id').selectOption(section);await save();assert.equal(uploadCount,1,'Metadata editing does not upload again');assert.equal(await page.locator('#sourceDetailSection').innerText(),'First area');
 await page.reload();await ready();assert.equal(await page.locator('#sourceDetailTitle').innerText(),'Garden inspiration');await page.waitForFunction(()=>document.querySelector('#sourceDetailImage img')?.naturalWidth>0);await page.screenshot({path:path.join(artifacts,'hq-private-image.png'),fullPage:true});
 const original=db.sources[0].storage_path;await page.locator('#sourceEdit').click();await field('upload').setInputFiles(root+'/images/book-nook.jpg');failCleanup=true;await save();assert.notEqual(db.sources[0].storage_path,original);assert.equal(objects.size,2);assert.equal(await page.locator('#sourceCleanup').isVisible(),true);await page.locator('#sourceCleanup').click();await ready();assert.equal(objects.size,1);assert.ok(!objects.has(original));
 await back();await openAdd('file');await field('upload').setInputFiles({name:'Project plan.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nFixture PDF for download')});await save();await detail('Project plan.pdf');await page.waitForFunction(()=>document.querySelector('#sourceFileOpen').hasAttribute('href'));assert.equal(await page.locator('#sourceFileOpen').innerText(),'Open PDF');assert.match(await page.locator('#sourceFileViewingHint').innerText(),/native viewer/);assert.equal(await page.locator('#sourceDetailImage').isHidden(),true);await back();
 await openAdd('file');await field('upload').setInputFiles({name:'ideas.txt',mimeType:'text/plain',buffer:Buffer.from('Notes in a text file')});await save();await detail('ideas.txt');assert.equal(await page.locator('#sourceFileOpen').isHidden(),true);await page.waitForFunction(()=>document.querySelector('#sourceFileDownload').href.includes('download='));await back();
 await page.locator('#sourceTypeFilter').selectOption('image');assert.equal(await page.locator('.source-card').count(),1);await page.locator('#sourceTypeFilter').selectOption('file');assert.equal(await page.locator('.source-card').count(),2);await page.locator('#sourceTypeFilter').selectOption('');
 await page.locator('[data-source-view=list]').tap();assert.equal(await page.locator('.source-file-extension').count(),2);await page.locator('[data-source-view=gallery]').tap();await page.screenshot({path:path.join(artifacts,'hq-upload-gallery.png'),fullPage:true});
 for(const width of [320,350,375,390,430,600,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}await page.setViewportSize({width:390,height:844});
 // Bad type/size are caught before submission; server catches forged contents.
 await openAdd('image');await field('upload').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.match(await editor.locator('[role=alert]').innerText(),/Choose JPEG/);await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 const count=db.sources.length,size=objects.size;await openAdd('image');await field('upload').setInputFiles({name:'fake.jpg',mimeType:'image/jpeg',buffer:Buffer.from('<html>not a picture</html>')});await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('contents'));assert.equal(db.sources.length,count);assert.equal(objects.size,size);await cancelReload();
 for(const failure of ['upload','commit']){await openAdd('image');await field('upload').setInputFiles(root+'/images/other.jpg');if(failure==='upload')failUpload=true;else failCommit=true;await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('Test'));assert.equal(db.sources.length,count);assert.equal(objects.size,size);await cancelReload();}
 // HEIC stays supported as an original even when this browser cannot decode it.
 const heic=Buffer.alloc(24);heic.writeUInt32BE(24,0);heic.write('ftypheic',4);heic.write('mif1',16);await openAdd('image');await field('upload').setInputFiles({name:'phone.heic',mimeType:'image/heic',buffer:heic});await save();await detail('phone.heic');await page.waitForFunction(()=>document.querySelector('#sourceDetailImage').innerText.includes('cannot display'));assert.match(await page.locator('#sourceFileViewingHint').innerText(),/HEIC/);await back();
 await detail('Garden inspiration');page.once('dialog',d=>d.dismiss());await page.locator('#sourceDelete').click();assert.ok(db.sources.some(s=>s.title==='Garden inspiration'));page.once('dialog',d=>{assert.match(d.message(),/private file/);return d.accept();});failDelete=true;await page.locator('#sourceDelete').click();await page.waitForFunction(()=>document.querySelector('#sourceError').textContent.includes('Deletion is pending'));await page.locator('#sourceReload').click();await ready();assert.equal(await page.locator('#sourceEdit').isDisabled(),true);await page.locator('#sourceCleanup').click();await ready();assert.ok(!db.sources.some(s=>s.title==='Garden inspiration'));assert.ok(db.sources.some(s=>s.title==='Project plan.pdf'));await back();
 unavailable=true;await openAdd('file');await field('upload').setInputFiles({name:'later.txt',mimeType:'text/plain',buffer:Buffer.from('Later')});await editor.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sourceEditor [role=alert]').textContent.includes('Stage 2B'));assert.match(await page.locator('#sourceSelectedFile').innerText(),/later.txt/);unavailable=false;await cancelReload();
 // Signed paths/access are cleared on sign-out; other users see no private sources.
 await detail('Project plan.pdf');await page.locator('#menuToggle').click();await page.locator('#logout').click();await page.waitForFunction(()=>!document.querySelector('#sourceSignIn').hidden);assert.equal(await page.locator('#sourceFileDownload').getAttribute('href'),null);assert.equal(await page.locator('#sourceDetailImage img').count(),0);
 await page.locator('#sourceSignIn').click();await page.locator('#email').fill('second@example.com');await page.locator('#password').fill('password');await page.locator('#loginForm button').click();await ready();await back();assert.equal(await page.locator('.source-card').count(),0);
 assert.ok(!requests.some(u=>u.includes('/object/public/')));assert.deepEqual(errors,[]);
 console.log('PASS uploads: single-file mobile picker/preview; duplicate prevention; private thumbnails and expired URL refresh; metadata-only edits; safe replacement/cleanup; PDF/TXT/HEIC handling; filters/list; failed upload/creation; partial delete retry; missing setup; refresh and sign-out; no public URLs. Local Supabase/Storage fixtures.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
